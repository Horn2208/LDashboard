// "Benachrichtigungen aktivieren": registers the service worker, subscribes to web push
// and stores the subscription in Supabase (cockpit_push_subs, owner-only RLS).
(function () {
  const VAPID_PUBLIC = "BD-HW_NsRNxivGM6gpcVFlkXi7PX3dKf22WSUDPybMkeMXoce36SYOPfWkrnOQCEVLvfbq7rU5StUHXGd-9qweY";
  const FN = "https://ochfgnkegxelfhabrflz.supabase.co/functions/v1/cockpit-push";
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  let reg = null;

  const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };

  function ui() {
    const box = document.getElementById("push-box"); if (!box) return;
    const st = document.getElementById("push-state"), on = document.getElementById("push-on"), test = document.getElementById("push-test");
    if (isIOS && !standalone) { st.textContent = "Auf dem iPhone: Teilen → „Zum Home-Bildschirm“, dann von dort öffnen."; on.hidden = true; test.hidden = true; return; }
    if (!supported) { st.textContent = "Dieser Browser kann keine Benachrichtigungen."; on.hidden = true; test.hidden = true; return; }
    const perm = Notification.permission;
    if (perm === "denied") { st.textContent = "Blockiert – in den Einstellungen für diese Seite erlauben."; on.hidden = true; test.hidden = true; return; }
    reg && reg.pushManager.getSubscription().then((s) => {
      st.textContent = s ? "Aktiv: 8 Uhr Wetter & Bahn, 11 Uhr Mensa" : "Aus";
      on.hidden = !!s; test.hidden = !s;
    });
  }

  async function enable() {
    const st = document.getElementById("push-state");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { ui(); return; }
      reg = reg || await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC) });
      const json = sub.toJSON();
      const { error } = await window.__sb.from("cockpit_push_subs").upsert({ endpoint: json.endpoint, sub: json }, { onConflict: "endpoint" });
      if (error) throw error;
      ui();
    } catch (e) { st.textContent = "Aktivieren fehlgeschlagen: " + (e.message || e); }
  }

  async function test() {
    const st = document.getElementById("push-state");
    const { data } = await window.__sb.auth.getSession();
    const r = await fetch(FN + "?kind=test", { method: "POST", headers: { authorization: "Bearer " + data.session.access_token } });
    st.textContent = r.ok ? "Test gesendet – kommt gleich." : "Test fehlgeschlagen (" + r.status + ")";
  }

  window.addEventListener("load", async () => {
    if ("serviceWorker" in navigator) { try { reg = await navigator.serviceWorker.register("/sw.js"); } catch (_) {} }
    const on = document.getElementById("push-on"), t = document.getElementById("push-test");
    on && on.addEventListener("click", enable);
    t && t.addEventListener("click", test);
    ui();
  });
})();
