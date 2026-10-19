// Mannheim weather for today (Bright Sky / DWD).
export default async function handler(req, res) {
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  try {
    const [cur, day] = await Promise.all([
      fetch("https://api.brightsky.dev/current_weather?lat=49.4875&lon=8.466&tz=Europe/Berlin").then((r) => r.json()),
      fetch(`https://api.brightsky.dev/weather?lat=49.4875&lon=8.466&date=${date}&tz=Europe/Berlin`).then((r) => r.json())
    ]);
    const hours = (day.weather || []).map((w) => ({ time: w.timestamp, temp: w.temperature, rain: w.precipitation_probability, icon: w.icon, condition: w.condition }));
    const temps = hours.map((h) => h.temp).filter((t) => typeof t === "number");
    const daytime = hours.filter((h) => { const hr = Number(String(h.time).slice(11, 13)); return hr >= 7 && hr <= 20; });
    res.setHeader("cache-control", "s-maxage=600, stale-while-revalidate=1200");
    return res.status(200).json({
      now: cur.weather ? { temp: cur.weather.temperature, icon: cur.weather.icon, condition: cur.weather.condition } : null,
      min: temps.length ? Math.min(...temps) : null,
      max: temps.length ? Math.max(...temps) : null,
      rainMax: Math.max(0, ...daytime.map((h) => h.rain || 0)),
      hours: daytime.filter((h, i) => i % 2 === 0)
    });
  } catch (e) {
    return res.status(502).json({ error: "fetch_failed" });
  }
}
