// Exchanges a Google refresh token for a fresh access token.
// Only callable by the signed-in owner: the Supabase session JWT is verified first.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_EMAIL } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(500).json({ error: "google_not_configured" });

  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { authorization: auth, apikey: SUPABASE_PUBLISHABLE_KEY } });
  if (!who.ok) return res.status(401).json({ error: "unauthorized" });
  const user = await who.json();
  if ((user.email || "").toLowerCase() !== (ALLOWED_EMAIL || "").toLowerCase()) return res.status(403).json({ error: "forbidden" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  if (!body.refresh_token) return res.status(400).json({ error: "missing_refresh_token" });

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: body.refresh_token, grant_type: "refresh_token" })
  });
  const j = await r.json();
  if (!r.ok) return res.status(401).json({ error: "refresh_failed", detail: j.error });
  res.setHeader("cache-control", "no-store");
  return res.status(200).json({ access_token: j.access_token, expires_in: j.expires_in });
}
