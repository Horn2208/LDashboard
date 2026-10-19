// Today's (or ?date=YYYY-MM-DD) menu for Mensa am Schloss via OpenMensa (canteen 285).
export default async function handler(req, res) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? req.query.date : today;
  const canteen = /^\d+$/.test(String(req.query.canteen || "")) ? req.query.canteen : "285";
  try {
    const r = await fetch(`https://openmensa.org/api/v2/canteens/${canteen}/days/${date}/meals`);
    if (r.status === 404) { res.setHeader("cache-control", "s-maxage=1800"); return res.status(200).json({ date, closed: true, meals: [] }); }
    if (!r.ok) return res.status(502).json({ error: "upstream", status: r.status });
    const meals = (await r.json()).map((m) => ({
      category: m.category,
      name: String(m.name || "").replace(/\s+,/g, ",").replace(/\s{2,}/g, " · ").trim(),
      price: m.prices?.students ?? null,
      perWeight: (m.notes || []).some((n) => /100g/.test(n)),
      vegan: /vegan/i.test(m.category || "") || (m.notes || []).includes("vegan"),
      vegetarian: /vegetar/i.test(m.category || "")
    }));
    res.setHeader("cache-control", "s-maxage=1800, stale-while-revalidate=3600");
    return res.status(200).json({ date, closed: meals.length === 0, meals });
  } catch (e) {
    return res.status(502).json({ error: "fetch_failed" });
  }
}
