import { hostMatches } from "./config.js";
import { err } from "./respond.js";

const AUDIO = /^audio\//i;
const IMAGE = /^image\//i;

function isPrivateHost(host) {
  // Block obvious non-public hostnames/IPs
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv6 loopback/link-local
  if (h === "::1" || h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [ +m[1], +m[2] ];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  return false;
}

export function validateMediaUrl(raw, cfg) {
  let u;
  try { u = new URL(raw); } catch { return { ok: false }; }
  if (u.protocol !== "https:") return { ok: false };
  const port = u.port || "443";
  if (port !== "443") return { ok: false };
  if (isPrivateHost(u.hostname)) return { ok: false };
  if (!hostMatches(u.hostname, cfg.cdnAllow)) return { ok: false };
  return { ok: true, url: u };
}

// Follow redirects manually, validating each hop. Returns final Response.
export async function fetchUpstream(url, cfg, { kind = "audio", request, maxHops = 3 } = {}) {
  let current = url;
  const range = request.headers.get("Range");
  for (let hop = 0; hop <= maxHops; hop++) {
    const v = validateMediaUrl(current, cfg);
    if (!v.ok) throw new ProxyError("blocked", 403);

    const headers = { "User-Agent": "MusicWorker/2.0" };
    if (range) headers.Range = range;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort("timeout"), cfg.upstreamTimeoutMs);
    let res;
    try {
      res = await fetch(v.url.toString(), { redirect: "manual", headers, signal: ac.signal });
    } finally {
      clearTimeout(t);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location");
      if (!loc) throw new ProxyError("bad redirect", 502);
      current = new URL(loc, v.url).toString();
      continue;
    }
    return res;
  }
  throw new ProxyError("too many redirects", 502);
}

export class ProxyError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

// Stream a media response back, enforcing size cap + MIME allowlist.
export async function proxyMedia(targetUrl, cfg, request, { kind = "audio" } = {}) {
  let res;
  try {
    res = await fetchUpstream(targetUrl, cfg, { kind, request });
  } catch (e) {
    if (e instanceof ProxyError) return err("BLOCKED_URL", { detail: e.message });
    return err("UPSTREAM", {});
  }
  if (!res.ok && res.status !== 206) return err("UPSTREAM", { upstream_status: res.status });

  const ctype = res.headers.get("Content-Type") || "";
  const okMime = kind === "audio" ? AUDIO.test(ctype) : IMAGE.test(ctype);
  if (!okMime) return err("BLOCKED_URL", { detail: "unexpected content-type" });

  const maxBytes = cfg.maxDownloadMB * 1024 * 1024;
  const cl = parseInt(res.headers.get("Content-Length") || "0", 10);
  if (cl > maxBytes) return err("TOO_LARGE", { max_mb: cfg.maxDownloadMB });

  const headers = new Headers();
  headers.set("Content-Type", ctype);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "public, max-age=300");
  if (res.headers.get("Accept-Ranges")) headers.set("Accept-Ranges", res.headers.get("Accept-Ranges"));
  if (res.headers.get("Content-Range")) headers.set("Content-Range", res.headers.get("Content-Range"));
  if (cl) headers.set("Content-Length", String(cl));

  // Cap enforced even if Content-Length absent/lying
  const body = capStream(res.body, maxBytes);
  const status = res.status === 206 ? 206 : 200;
  return new Response(body, { status, headers });
}

function capStream(stream, maxBytes) {
  if (!stream) return stream;
  const reader = stream.getReader();
  let sent = 0;
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { controller.close(); return; }
      sent += value.byteLength;
      if (sent > maxBytes) { controller.error(new ProxyError("too large", 413)); reader.cancel(); return; }
      controller.enqueue(value);
    },
    cancel() { reader.cancel(); },
  });
}
