// Sends Lenny's daily web-push notifications (morning: weather + RNV, mensa: today's menu).
// Triggered by pg_cron (x-cron-secret) or by the signed-in owner for a test (Authorization: Bearer <jwt>).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const OWNER = "l.schierhorn07@gmail.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const berlin = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
};
const hm = (iso: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const ICON: Record<string, string> = { "clear-day": "☀️", "clear-night": "🌙", "partly-cloudy-day": "⛅", "partly-cloudy-night": "☁️", cloudy: "☁️", fog: "🌫️", wind: "💨", rain: "🌧️", sleet: "🌨️", snow: "❄️", hail: "🌨️", thunderstorm: "⛈️" };

async function morning(): Promise<{ title: string; body: string } | null> {
  const { date } = berlin();
  let wx = "Wetter nicht verfügbar";
  let rainy = false;
  try {
    const j = await (await fetch(`https://api.brightsky.dev/weather?lat=49.4875&lon=8.466&date=${date}&tz=Europe/Berlin`)).json();
    const day = (j.weather || []).filter((w: any) => { const h = Number(String(w.timestamp).slice(11, 13)); return h >= 7 && h <= 20; });
    const temps = day.map((w: any) => w.temperature).filter((t: any) => typeof t === "number");
    const rain = Math.max(0, ...day.map((w: any) => w.precipitation_probability || 0));
    const icon = ICON[day.find((w: any) => String(w.timestamp).slice(11, 13) === "09")?.icon] || "🌡️";
    rainy = rain >= 50;
    wx = `${icon} ${Math.round(Math.min(...temps))}–${Math.round(Math.max(...temps))}°, Regen ${rain} %`;
  } catch (_) { /* keep fallback */ }
  let deps = "Abfahrten gerade nicht verfügbar";
  try {
    const j = await (await fetch("https://www.vrn.de/mngvrn/XML_DM_REQUEST?outputFormat=rapidJSON&type_dm=any&name_dm=de:08222:6006&mode=direct&useRealtime=1&limit=12")).json();
    deps = (j.stopEvents || []).filter((e: any) => !/\b62\b/.test(String(e.transportation?.number || ""))).slice(0, 4).map((e: any) => {
      const p = e.departureTimePlanned, est = e.departureTimeEstimated || p;
      const late = Math.round((Date.parse(est) - Date.parse(p)) / 60000);
      return `${String(e.transportation?.number || "").replace(/^RNV\s*/, "")} ${String(e.transportation?.destination?.name || "").replace(/^Mannheim,\s*/, "")} ${hm(est)}${late > 0 ? ` (+${late})` : ""}`;
    }).join(" · ") || deps;
  } catch (_) { /* keep fallback */ }
  return { title: (rainy ? "☔ Schirm mitnehmen · " : "") + "Guten Morgen", body: `${wx}\nPopakademie: ${deps}` };
}

async function mensa(): Promise<{ title: string; body: string } | null> {
  const { date } = berlin();
  const r = await fetch(`https://openmensa.org/api/v2/canteens/285/days/${date}/meals`);
  if (!r.ok) return null;
  const meals = (await r.json()).filter((m: any) => !/salat|dessert/i.test(m.category || ""));
  if (!meals.length) return null;
  const body = meals.map((m: any) => {
    const name = String(m.name || "").split(/\s*,\s*|\s{2,}/).filter(Boolean).slice(0, 2).join(", ");
    const per = (m.notes || []).some((n: string) => /100g/.test(n)) ? "/100 g" : "";
    const price = m.prices?.students != null ? ` ${Number(m.prices.students).toFixed(2).replace(".", ",")} €${per}` : "";
    return `${/vegan/i.test(m.category || "") ? "🌱 " : ""}${name}${price}`;
  }).join("\n");
  return { title: "🍽 Mensa am Schloss heute", body };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "test";
  const { data: cfg, error } = await admin.rpc("cockpit_push_config");
  if (error || !cfg) return new Response("config missing", { status: 500 });

  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // auth: cron secret, or the owner's own session
  const isCron = req.headers.get("x-cron-secret") === cfg.cron;
  if (!isCron) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(jwt);
    if ((u?.user?.email || "").toLowerCase() !== OWNER) return new Response("forbidden", { status: 403, headers: cors });
  }

  // cron fires at both CET and CEST slots; only send in the right Berlin hour
  const { hour } = berlin();
  if (isCron && ((kind === "morning" && hour !== 7) || (kind === "mensa" && hour !== 10))) return new Response("skip (wrong local hour)", { headers: cors });

  let msg = kind === "morning" ? await morning() : kind === "mensa" ? await mensa() : { title: "Cockpit", body: "Benachrichtigungen funktionieren ✅" };
  if (kind === "test-morning") msg = await morning();
  if (kind === "test-mensa") msg = (await mensa()) || { title: "🍽 Mensa", body: "Heute geschlossen oder noch kein Plan." };
  if (!msg) return new Response("nothing to send", { headers: cors });

  webpush.setVapidDetails("mailto:" + OWNER, cfg.pub, cfg.priv);
  const { data: subs } = await admin.from("cockpit_push_subs").select("endpoint, sub");
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ ...msg, url: "/", tag: kind, icon: "/icon-192.png", badge: "/badge-96.png" }), { TTL: 3600 });
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("cockpit_push_subs").delete().eq("endpoint", s.endpoint);
    }
  }
  return new Response(JSON.stringify({ kind, sent }), { headers: { ...cors, "content-type": "application/json" } });
});
