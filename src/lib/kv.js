// Rate limiting via KV. Token-bucket-ish fixed window.
export async function rateLimit(kv, key, limit, windowSec) {
  if (!kv) return { allowed: true, remaining: limit };
  const now = Math.floor(Date.now() / 1000);
  const win = Math.floor(now / windowSec);
  const k = `rl:${key}:${win}`;
  let n = 0;
  try {
    n = parseInt((await kv.get(k)) || "0", 10);
    if (n >= limit) return { allowed: false, remaining: 0, retry: windowSec - (now % windowSec) };
    await kv.put(k, String(n + 1), { expirationTtl: windowSec * 2 });
  } catch { /* KV failure -> allow (fail-open) */ }
  return { allowed: true, remaining: limit - n - 1 };
}

export async function cacheGet(kv, key) {
  if (!kv) return null;
  try { const v = await kv.get(key, "json"); return v; } catch { return null; }
}
export async function cachePut(kv, key, val, ttl) {
  if (!kv) return;
  try { await kv.put(key, JSON.stringify(val), { expirationTtl: ttl }); } catch {}
}
