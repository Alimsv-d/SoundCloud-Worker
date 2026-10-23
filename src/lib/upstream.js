// Fetch with timeout + circuit breaker.
export class UpstreamError extends Error {
  constructor(msg, status, kind = "network") {
    super(msg);
    this.status = status; this.kind = kind;
  }
}

export async function fetchJson(url, { timeout = 10000, headers } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort("timeout"), timeout);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: { "User-Agent": "MusicWorker/2.0", Accept: "application/json", ...(headers || {}) },
    });
    if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, res.status, "http");
    return await res.json();
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    if (ac.signal.aborted) throw new UpstreamError("timeout", 504, "timeout");
    throw new UpstreamError(e.message || "network", 0, "network");
  } finally {
    clearTimeout(t);
  }
}

export class CircuitBreaker {
  constructor(name, { threshold = 4, cooldownMs = 30000 } = {}) {
    this.name = name;
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.failures = 0;
    this.openedAt = 0;
  }
  isOpen() {
    if (this.failures < this.threshold) return false;
    if (Date.now() - this.openedAt > this.cooldownMs) { this.failures = 0; return false; }
    return true;
  }
  success() { this.failures = 0; }
  failure() {
    this.failures++;
    this.openedAt = Date.now();
  }
  async call(fn) {
    if (this.isOpen()) throw new UpstreamError(`${this.name} circuit open`, 503, "circuit");
    try {
      const r = await fn();
      this.success();
      return r;
    } catch (e) {
      this.failure();
      throw e;
    }
  }
}
