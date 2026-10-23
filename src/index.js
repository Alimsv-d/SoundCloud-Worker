import { getConfig } from "./lib/config.js";
import { json, err, requestId } from "./lib/respond.js";
import { buildProviders, searchAll, findProvider } from "./providers/registry.js";
import { proxyMedia, validateMediaUrl, fetchUpstream } from "./lib/proxy.js";
import { rateLimit, cacheGet, cachePut } from "./lib/kv.js";
import { renderPage } from "./lib/ui.js";
import { openapi } from "./lib/openapi.js";
import { normalizeQuery, detectLang } from "./lib/text.js";

const JSON_CT = "application/json; charset=utf-8";

function securityHeaders(h) {
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  return h;
}

function csp(nonce) {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; ` +
    `img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}

function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") || "anon";
}

function authed(request, cfg) {
  if (!cfg.apiKeys) return true;
  const k = request.headers.get("x-api-key") ||
    (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return cfg.apiKeys.includes(k);
}

async function etagFor(body) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return '"' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("") + '"';
}

export default {
  async fetch(request, env, ctx) {
    const reqId = requestId();
    const url = new URL(request.url);
    const path = url.pathname;
    const cfg = getConfig(env);
    const kv = env.CACHE_KV || null;
    const prov = buildProviders(cfg);

    try {
      // ---- Web page -------------------------------------------------------
      if ((path === "/" || path === "") && (request.method === "GET" || request.method === "HEAD")) {
        const acc = request.headers.get("Accept") || "";
        const wantsHtml = /text\/html/.test(acc);
        const wantsJson = /application\/json/.test(acc) || /\*\/\*/.test(acc) || !acc;
        if (wantsHtml && !wantsJson) {
          const lang = url.searchParams.get("lang") === "en" ? "en" : "fa";
          const nonce = crypto.randomUUID().replace(/-/g, "");
          const html = renderPage({ lang, nonce });
          const h = securityHeaders(new Headers());
          h.set("Content-Type", "text/html; charset=utf-8");
          h.set("Content-Security-Policy", csp(nonce));
          h.set("Cache-Control", "private, no-store");
          h.set("ETag", await etagFor(html));
          return new Response(request.method === "HEAD" ? null : html, { headers: h });
        }
        // JSON summary for */* or application/json
        return json({
          name: "Music Search & Download API", version: "2.0.0",
          docs: "/openapi.json",
          endpoints: ["/api/v1/search", "/api/v1/track", "/api/v1/download",
            "/api/v1/stream", "/api/v1/cover", "/health", "/openapi.json"],
        }, {}, reqId);
      }

      // ---- Health ---------------------------------------------------------
      if (path === "/health" && request.method === "GET") {
        const deep = url.searchParams.get("deep") === "1";
        const providers = {};
        for (const p of prov.list) {
          providers[p.name] = { configured: !!p.configured, healthy: true };
          if (deep && p.configured) {
            try { providers[p.name].healthy = await p.health({ timeout: cfg.upstreamTimeoutMs }); }
            catch { providers[p.name].healthy = false; }
          } else if (!p.configured) {
            providers[p.name].healthy = false;
          }
        }
        return json({ status: "ok", kv: !!kv, providers }, {}, reqId);
      }

      // ---- OpenAPI --------------------------------------------------------
      if (path === "/openapi.json" && request.method === "GET") {
        return json(openapi(url.origin), {}, reqId);
      }

      // ---- API ------------------------------------------------------------
      if (path.startsWith("/api/v1/")) {
        if (!authed(request, cfg)) return err("UNAUTHORIZED", {}, reqId);

        const isMedia = /stream|cover|download/.test(path);
        const rl = await rateLimit(kv, `${isMedia ? "m" : "s"}:${clientKey(request)}`,
          isMedia ? cfg.rateMedia : cfg.rateSearch, cfg.rateWindowSec);
        if (!rl.allowed) return err("RATE_LIMITED", { retry_after: rl.retry }, reqId);

        if (path === "/api/v1/search") return await doSearch(url, prov, cfg, kv, reqId);
        if (path === "/api/v1/track") return await doTrack(url, prov, cfg, reqId);
        if (path === "/api/v1/download") return await doDownload(url, prov, cfg, request, reqId);
        if (path === "/api/v1/stream") return await doStream(url, cfg, request, reqId);
        if (path === "/api/v1/cover") return await doCover(url, cfg, request, reqId);
        return err("NOT_FOUND", {}, reqId);
      }

      return err("NOT_FOUND", {}, reqId);
    } catch (e) {
      return err("INTERNAL", { detail: String(e && e.message || e) }, reqId);
    }
  },
};

function present(t, base) {
  const dl = t.downloadable && t.downloads.length
    ? `${base}/api/v1/download?id=${encodeURIComponent(t.id)}&index=0` : null;
  return {
    id: t.id, source: t.source, title: t.title, artist: t.artist,
    duration: t.duration_ms ? Math.round(t.duration_ms / 1000) + "s" : null,
    cover: t.cover, preview_url: t.preview_url, page_url: t.page_url,
    downloadable: t.downloadable, download: dl,
    options: t.downloads.map((d) => d.label), license: t.license,
  };
}

async function doSearch(url, prov, cfg, kv, reqId) {
  const q = url.searchParams.get("q");
  if (!q || !q.trim()) return err("BAD_REQUEST", { param: "q" }, reqId);
  const source = url.searchParams.get("source") || "all";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  const cacheKey = `s:${normalizeQuery(q)}:${source}:${page}`;
  const cached = await cacheGet(kv, cacheKey);
  if (cached) return json(cached, { headers: { "X-Cache": "HIT" } }, reqId);

  const { results, providerErrors } = await searchAll(prov, q, {
    source, page, timeout: cfg.upstreamTimeoutMs });
  const base = url.origin;
  const body = {
    query: q, page, count: results.length,
    results: results.map((t) => present(t, base)),
    errors: Object.keys(providerErrors).length ? providerErrors : undefined,
  };
  await cachePut(kv, cacheKey, body, cfg.cacheTTL);
  const res = json(body, {}, reqId);
  res.headers.set("Cache-Control", `public, max-age=${cfg.cacheTTL}`);
  return res;
}

async function doTrack(url, prov, cfg, reqId) {
  const id = url.searchParams.get("id");
  if (!id) return err("BAD_REQUEST", { param: "id" }, reqId);
  const p = findProvider(prov, id);
  if (!p || !p.configured) return err("NOT_FOUND", { id }, reqId);
  let t;
  try { t = await p.get(id, { timeout: cfg.upstreamTimeoutMs }); }
  catch { return err("UPSTREAM", {}, reqId); }
  if (!t) return err("NOT_FOUND", { id }, reqId);
  return json({ track: { ...t, downloads: t.downloads.map((d) => d.label) } }, {}, reqId);
}

async function doDownload(url, prov, cfg, request, reqId) {
  const id = url.searchParams.get("id");
  const index = parseInt(url.searchParams.get("index") || "0", 10);
  if (!id) return err("BAD_REQUEST", { param: "id" }, reqId);
  const p = findProvider(prov, id);
  if (!p || !p.configured) return err("NOT_FOUND", { id }, reqId);
  let t;
  try { t = await p.get(id, { timeout: cfg.upstreamTimeoutMs }); }
  catch { return err("UPSTREAM", {}, reqId); }
  if (!t) return err("NOT_FOUND", { id }, reqId);
  if (!t.downloadable || !t.downloads.length) return err("NOT_DOWNLOADABLE", { id }, reqId);
  const dl = t.downloads[index] || t.downloads[0];
  const res = await proxyMedia(dl.url, cfg, request, { kind: "audio" });
  if (res instanceof Response && res.ok) {
    res.headers.set("Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent((t.title || "track").replace(/[^\w\u0600-\u06FF -]/g, "_"))}`);
  }
  return res;
}

async function doStream(url, cfg, request, reqId) {
  const target = url.searchParams.get("url");
  if (!target) return err("BAD_REQUEST", { param: "url" }, reqId);
  if (!validateMediaUrl(target, cfg).ok) return err("BLOCKED_URL", {}, reqId);
  return await proxyMedia(target, cfg, request, { kind: "audio" });
}

async function doCover(url, cfg, request, reqId) {
  const target = url.searchParams.get("url");
  if (!target) return err("BAD_REQUEST", { param: "url" }, reqId);
  if (!validateMediaUrl(target, cfg).ok) return err("BLOCKED_URL", {}, reqId);
  return await proxyMedia(target, cfg, request, { kind: "image" });
}
