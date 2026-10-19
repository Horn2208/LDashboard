// Reads the newest mails from Lenny's Uni Mannheim Exchange mailbox via IMAP (read-only).
// Credentials live only in the function secrets UNI_ID / UNI_PASSWORD.
// Auth: the signed-in owner (Authorization: Bearer <jwt>) or pg_net with x-cron-secret (for health checks).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { ImapFlow } from "npm:imapflow@1.0.164";

const OWNER = "l.schierhorn07@gmail.com";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info, x-cron-secret" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const { data: cfg } = await admin.rpc("cockpit_push_config");
  const isCron = !!cfg && req.headers.get("x-cron-secret") === cfg.cron;
  if (!isCron) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(jwt);
    if ((u?.user?.email || "").toLowerCase() !== OWNER) return json({ error: "forbidden" }, 403);
  }

  const user = Deno.env.get("UNI_ID"), pass = Deno.env.get("UNI_PASSWORD");
  if (!user || !pass) return json({ error: "not_configured" }, 200);

  const limit = Math.min(20, Number(new URL(req.url).searchParams.get("limit") || 10));
  const client = new ImapFlow({ host: "exchange.uni-mannheim.de", port: 993, secure: true, auth: { user, pass }, logger: false, socketTimeout: 20000 });
  try {
    await client.connect();
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    const total = box.exists || 0;
    const threads: unknown[] = [];
    let unread = 0;
    if (total > 0) {
      const from = Math.max(1, total - limit + 1);
      for await (const m of client.fetch(`${from}:*`, { envelope: true, flags: true, internalDate: true, uid: true })) {
        const f = m.envelope?.from?.[0];
        const seen = m.flags?.has("\\Seen");
        if (!seen) unread++;
        threads.push({
          id: String(m.uid),
          viewUrl: "https://exchange.uni-mannheim.de/owa/",
          messages: [{
            id: String(m.uid),
            sender: f ? (f.name ? `"${f.name}" <${f.address}>` : f.address) : "",
            subject: m.envelope?.subject || "",
            snippet: "",
            date: (m.internalDate || m.envelope?.date || new Date()).toISOString?.() ?? String(m.internalDate),
            labelIds: seen ? [] : ["UNREAD"],
          }],
        });
      }
    }
    threads.reverse();
    return json({ threads, total, unread });
  } catch (e) {
    const msg = String((e as any)?.responseText || (e as any)?.message || e);
    const auth = (e as any)?.authenticationFailed || /auth|login|credential/i.test(msg);
    return json({ error: auth ? "auth_failed" : "imap_error", message: msg.slice(0, 200) }, 502);
  } finally {
    try { await client.logout(); } catch (_) { /* ignore */ }
  }
});
