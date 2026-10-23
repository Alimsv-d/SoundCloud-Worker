// Live smoke test: hits each keyless upstream and reports reachability.
const TIMEOUT = 12000;
const tests = [
  ["deezer", "https://api.deezer.com/search?q=test&limit=1"],
  ["itunes", "https://itunes.apple.com/search?term=test&limit=1"],
  ["openverse", "https://api.openverse.org/v1/audio/?q=test&page_size=1"],
  ["archive", "https://archive.org/advancedsearch.php?q=test&rows=1&output=json"],
];

for (const [name, url] of tests) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT),
      headers: { "User-Agent": "smoke-test" } });
    const ok = r.ok;
    let n = "?";
    try { const j = await r.json();
      n = j.data?.length ?? j.results?.length ?? j.response?.docs?.length ?? "?";
    } catch {}
    console.log(`${ok ? "✓" : "✗"} ${name.padEnd(10)} HTTP ${r.status}  ${Date.now()-t0}ms  results=${n}`);
  } catch (e) {
    console.log(`✗ ${name.padEnd(10)} unreachable (${e.name}: ${String(e.message).slice(0,60)}) — possibly blocked from this host`);
  }
}
