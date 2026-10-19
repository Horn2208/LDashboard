// Live departures for Mannheim Popakademie (VRN EFA, stop de:08222:6006).
export default async function handler(req, res) {
  const stop = "de:08222:6006";
  const url = `https://www.vrn.de/mngvrn/XML_DM_REQUEST?outputFormat=rapidJSON&type_dm=any&name_dm=${encodeURIComponent(stop)}&mode=direct&useRealtime=1&limit=12`;
  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return res.status(502).json({ error: "upstream", status: r.status });
    const j = await r.json();
    const departures = (j.stopEvents || []).map((e) => ({
      line: String(e.transportation?.number || e.transportation?.disassembledName || "").replace(/^RNV\s*/, ""),
      to: String(e.transportation?.destination?.name || "").replace(/^Mannheim,\s*/, ""),
      planned: e.departureTimePlanned,
      estimated: e.departureTimeEstimated || null,
      platform: e.location?.properties?.platform || e.location?.disassembledName || ""
    }));
    res.setHeader("cache-control", "s-maxage=30, stale-while-revalidate=30");
    return res.status(200).json({ stop: "Popakademie", departures });
  } catch (e) {
    return res.status(502).json({ error: "fetch_failed" });
  }
}
