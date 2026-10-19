/*
 * Ldashboard runtime shim.
 * The dashboard page was written against the claude.ai artifact runtime
 * (window.claude.use("db" | "user" | "mcp")). On Vercel we provide the same
 * small API surface backed by Supabase (storage + Google login) and the
 * Google Calendar / Gmail REST APIs, so the page code stays unchanged.
 */
(function () {
  const C = window.LDASH_CONFIG;
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
  });
  window.__sb = sb;

  const TOK = "ldash-google";
  const TOKEN_FN = C.supabaseUrl + "/functions/v1/google-token";
  const readTok = () => { try { return JSON.parse(localStorage.getItem(TOK) || "null"); } catch (e) { return null; } };
  const writeTok = (t) => { try { localStorage.setItem(TOK, JSON.stringify(t)); } catch (e) {} };

  // ---------- auth gate ----------
  let session = null;
  const ready = new Promise((resolve) => {
    sb.auth.onAuthStateChange((_ev, s) => {
      session = s;
      if (s && s.provider_token) {
        writeTok({ access: s.provider_token, exp: Date.now() + 55 * 60 * 1000 });
        // keep the long-lived Google refresh token on the server, so every device stays connected
        if (s.provider_refresh_token) {
          fetch(TOKEN_FN, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + s.access_token },
            body: JSON.stringify({ action: "store", refresh_token: s.provider_refresh_token }) }).catch(() => {});
        }
      }
    });
    sb.auth.getSession().then(({ data }) => { session = data.session; resolve(); });
  });

  function showLogin(msg) {
    if (document.getElementById("ldash-login")) return;
    const el = document.createElement("div");
    el.id = "ldash-login";
    el.innerHTML = `
      <div class="ldash-card glass">
        <span class="brand-tile">HWS</span>
        <h1>Cockpit</h1>
        <p>${msg || "Melde dich mit deinem Google-Konto an. Kalender und Gmail werden nur gelesen."}</p>
        <button class="btn" id="ldash-google" type="button">Mit Google anmelden</button>
      </div>`;
    document.body.appendChild(el);
    document.getElementById("ldash-google").addEventListener("click", login);
  }
  async function login() {
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: C.googleScopes,
        redirectTo: location.origin + location.pathname,
        queryParams: { access_type: "offline", prompt: "consent" }
      }
    });
  }
  window.ldashLogout = async () => { try { localStorage.removeItem(TOK); } catch (e) {} await sb.auth.signOut(); location.reload(); };

  const gate = ready.then(() => {
    if (!session) { showLogin(); return false; }
    if ((session.user.email || "").toLowerCase() !== C.allowedEmail) {
      showLogin("Dieses Konto hat keinen Zugriff. Melde dich mit deinem eigenen Google-Konto an.");
      sb.auth.signOut();
      return false;
    }
    return true;
  });

  // ---------- Google token ----------
  async function googleToken(force) {
    const t = readTok();
    if (t && t.access && !force && t.exp > Date.now()) return t.access;
    const { data: sd } = await sb.auth.getSession();
    const r = await fetch(TOKEN_FN, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + (sd.session || session).access_token },
      body: JSON.stringify({ action: "access" })
    });
    if (!r.ok) throw { code: "needs_reauth", message: "Google-Token konnte nicht erneuert werden" };
    const j = await r.json();
    writeTok({ access: j.access_token, exp: Date.now() + (j.expires_in - 300) * 1000 });
    return j.access_token;
  }
  let reconnectShown = false;
  function showReconnect() {
    if (reconnectShown) return; reconnectShown = true;
    const el = document.createElement("div");
    el.id = "ldash-reconnect";
    el.className = "glass";
    el.setAttribute("role", "status");
    el.innerHTML = '<span>Google-Verbindung abgelaufen. Kalender und Mails sind gerade nicht aktuell.</span><button class="btn" type="button">Neu verbinden</button>';
    el.querySelector("button").addEventListener("click", login);
    document.body.appendChild(el);
  }
  async function gfetch(url) {
    let tok = await googleToken(false);
    let r = await fetch(url, { headers: { authorization: "Bearer " + tok } });
    if (r.status === 401) { tok = await googleToken(true); r = await fetch(url, { headers: { authorization: "Bearer " + tok } }); }
    if (r.status === 401 || r.status === 403) throw { code: "needs_reauth", message: "Kein Zugriff auf Google (" + r.status + ")" };
    if (r.status >= 500 || r.status === 429) throw { code: "server_unavailable", retryable: true, message: "Google antwortet nicht" };
    if (!r.ok) throw { code: "tool_error", message: "Google-Fehler " + r.status };
    return r.json();
  }

  // ---------- "mcp": Google Calendar + Gmail ----------
  async function calendarListEvents(input) {
    const p = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: String(input.pageSize || 150), timeZone: input.timeZone || "Europe/Berlin" });
    if (input.startTime) p.set("timeMin", input.startTime);
    if (input.endTime) p.set("timeMax", input.endTime);
    const j = await gfetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?" + p);
    return { events: j.items || [] };
  }
  async function gmailSearchThreads(input) {
    // The page queries by label ID (connector syntax); Gmail's own search wants label names.
    const LABELS = { Label_2: "bewerbung", Label_3: "Uni", Label_4: "Uni/Grundlagen Info", Label_5: "Uni/Marketing", Label_6: "Uni/Praktische Info 1",
      Label_7: "Uni/Programmier Praktikum 1", Label_8: "Uni/Wifo 1", Label_9: "Uni/Orga", Label_10: "Initiativen", Label_11: "Termin", Label_12: "Frist",
      Label_13: "Geld", Label_14: "Sicherheit", Label_15: "Newsletter", Label_16: "Persönlich" };
    const q = String(input.query || "").replace(/label:(Label_\d+)/g, (m, id) => LABELS[id] ? "label:" + LABELS[id].toLowerCase().replace(/[\s\/]+/g, "-") : m);
    const p = new URLSearchParams({ q, maxResults: String(input.pageSize || 8) });
    const list = await gfetch("https://gmail.googleapis.com/gmail/v1/users/me/threads?" + p);
    const threads = await Promise.all((list.threads || []).map(async (t) => {
      const th = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const messages = (th.messages || []).map((m) => {
        const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
        return { id: m.id, sender: h.from || "", subject: h.subject || "", snippet: m.snippet || "", labelIds: m.labelIds || [],
          date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : h.date };
      });
      return { id: t.id, messages, viewUrl: "https://mail.google.com/mail/u/0/#all/" + t.id };
    }));
    return { threads };
  }
  const TOOLS = { "Google Calendar/list_events": calendarListEvents, "Gmail/search_threads": gmailSearchThreads };

  const mcp = {
    async callTool(server, tool, input) {
      const fn = TOOLS[server + "/" + tool];
      if (!fn) throw { code: "not_in_manifest", message: "Unbekanntes Tool" };
      const payload = await fn(input || {});
      return { content: [], payload };
    },
    watchTool(server, tool, input, handler, opts) {
      let stopped = false, timer = 0;
      const run = async () => {
        try { const res = await mcp.callTool(server, tool, input); if (!stopped) handler({ type: "data", result: res }); }
        catch (e) { if (e && e.code === "needs_reauth") showReconnect(); if (!stopped) handler({ type: "error", error: e && e.code ? e : { code: "upstream_error", message: String(e && e.message || e) } }); }
        if (!stopped && opts && opts.refetchInterval) timer = setTimeout(run, Math.max(30000, opts.refetchInterval));
      };
      setTimeout(run, 0);
      return () => { stopped = true; clearTimeout(timer); };
    },
    async listTools() { return { servers: [] }; }
  };

  // ---------- "db": Supabase table cockpit_items ----------
  function makeDb() {
    let cache = new Map();
    const listeners = new Set();
    const emit = () => {
      const docs = [...cache.values()].map((r) => ({ id: r.id, exists: true, data: () => ({ ...r.data }) , metadata: {} }));
      const snap = { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} };
      listeners.forEach((l) => { try { l.next(snap); } catch (e) {} });
    };
    const load = async () => {
      const { data, error } = await sb.from("cockpit_items").select("id,kind,data");
      if (error) { listeners.forEach((l) => l.error && l.error({ code: "unavailable", message: error.message })); return; }
      cache = new Map(data.map((r) => [r.id, r]));
      emit();
    };
    let channel = null;
    const subscribe = () => {
      if (channel) return;
      channel = sb.channel("cockpit-items")
        .on("postgres_changes", { event: "*", schema: "public", table: "cockpit_items" }, () => load())
        .subscribe();
      document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
    };
    const write = async (op) => {
      const { error } = await op;
      if (error) throw { code: error.code === "42501" ? "permission_denied" : "unavailable", message: error.message };
      await load();
    };
    const doc = (id) => ({
      id,
      async get() { const r = cache.get(id); return { id, exists: !!r, data: () => (r ? { ...r.data } : undefined) }; },
      set(data) { cache.set(id, { id, kind: data.kind || "item", data }); emit(); return write(sb.from("cockpit_items").upsert({ id, kind: data.kind || "item", data }, { onConflict: "user_id,id" })); },
      update(patch) {
        const cur = cache.get(id); const next = { ...(cur ? cur.data : {}), ...patch };
        cache.set(id, { id, kind: next.kind || "item", data: next }); emit();
        return write(sb.from("cockpit_items").update({ data: next, kind: next.kind || "item" }).eq("id", id));
      },
      delete() { cache.delete(id); emit(); return write(sb.from("cockpit_items").delete().eq("id", id)); },
      onSnapshot(next, error) { const l = { next: (s) => { const r = cache.get(id); next({ id, exists: !!r, data: () => (r ? { ...r.data } : undefined), metadata: {} }); }, error }; listeners.add(l); subscribe(); load(); return () => listeners.delete(l); }
    });
    const collection = () => ({
      doc: (id) => doc(id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2))),
      async add(data) { const d = doc(crypto.randomUUID()); await d.set(data); return d; },
      onSnapshot(next, error) { const l = { next, error }; listeners.add(l); subscribe(); load(); return () => listeners.delete(l); },
      async get() { await load(); const docs = [...cache.values()].map((r) => ({ id: r.id, exists: true, data: () => ({ ...r.data }) })); return { docs, size: docs.length, empty: !docs.length }; },
      where() { return this; }, orderBy() { return this; }, limit() { return this; }
    });
    return { collection, doc: (path) => doc(String(path).split("/").pop()) };
  }

  const user = {
    async id() { return session ? session.user.id : null; },
    async me() { return { id: session ? session.user.id : null, name: session?.user?.user_metadata?.full_name || "", email: null }; },
    isOwner() { return true; }, canEdit() { return true; }, can() { return true; }
  };

  let dbInst = null;
  window.claude = {
    async use(name) {
      const ok = await gate;
      if (!ok) return null;
      if (name === "db") return dbInst || (dbInst = makeDb());
      if (name === "user") return user;
      if (name === "mcp") return mcp;
      return null;
    }
  };
})();
