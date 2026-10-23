/* ============================================================================
 * Music Search & Download — single-file Cloudflare Worker
 * Aggregates legal music sources (Deezer, iTunes, Openverse, Internet Archive
 * keyless; optional Jamendo, SoundCloud via secrets). Persian RTL UI.
 * Deploy: paste this file into the Workers editor, or use the Deploy button.
 * ========================================================================== */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹", AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/* ------------------------------ text utils ------------------------------ */
function normalizeQuery(input) {
  if (input == null) return "";
  let s = String(input);
  s = s.replace(/ي/g, "ی").replace(/ى/g, "ی").replace(/ك/g, "ک");
  s = s.replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c)));
  s = s.replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c)));
  s = s.replace(/[ً-ٟـ]/g, "");
  return s.replace(/\s+/g, " ").trim();
}
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* -------------------------------- config -------------------------------- */
function getConfig(env) {
  const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
  const list = (v, d) => v ? String(v).split(",").map(x => x.trim().toLowerCase()).filter(Boolean) : d;
  return {
    maxDownloadMB: num(env.MAX_DOWNLOAD_MB, 50),
    cacheTTL: num(env.CACHE_TTL_SECONDS, 60),
    upstreamTimeoutMs: num(env.UPSTREAM_TIMEOUT_MS, 10000),
    rateSearch: num(env.RATE_LIMIT_SEARCH, 30),
    rateMedia: num(env.RATE_LIMIT_MEDIA, 60),
    rateWindowSec: num(env.RATE_LIMIT_WINDOW_SEC, 60),
    cdnAllow: list(env.CDN_ALLOWLIST, [
      "sndcdn.com","dzcdn.net","mzstatic.com","jamendo.com","jamendo.net",
      "archive.org","us.archive.org","prod-images.openverse.org","api.openverse.org"]),
    apiKeys: list(env.API_KEYS, null),
    jamendoClientId: env.JAMENDO_CLIENT_ID || null,
    soundcloudClientId: env.SOUNDCLOUD_CLIENT_ID || null,
  };
}
const hostMatch = (host, list) => {
  host = (host || "").toLowerCase();
  return list.some(d => host === d || host.endsWith("." + d));
};

/* ------------------------------- responses ------------------------------ */
const rid = () => crypto.randomUUID();
function json(data, init = {}, reqId) {
  const h = new Headers(init.headers || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify({ ok: true, request_id: reqId || rid(), ...data }),
    { status: init.status || 200, headers: h });
}
const ERR = {
  BAD_REQUEST: [400, "BAD_REQUEST", "درخواست نامعتبر است", "Invalid request"],
  NOT_FOUND: [404, "NOT_FOUND", "پیدا نشد", "Not found"],
  UNAUTHORIZED: [401, "UNAUTHORIZED", "احراز هویت لازم است", "Authentication required"],
  RATE_LIMITED: [429, "RATE_LIMITED", "تعداد درخواست بیش از حد", "Rate limit exceeded"],
  UPSTREAM: [502, "UPSTREAM_ERROR", "خطا در سرویس بالادست", "Upstream service error"],
  TIMEOUT: [504, "UPSTREAM_TIMEOUT", "مهلت تمام شد", "Upstream timeout"],
  TOO_LARGE: [413, "PAYLOAD_TOO_LARGE", "حجم بیش از حد مجاز", "Payload too large"],
  BLOCKED_URL: [403, "BLOCKED_URL", "نشانی مسدود است", "Blocked URL"],
  NOT_DOWNLOADABLE: [403, "NOT_DOWNLOADABLE", "دانلود برای این ترک مجاز نیست", "Download not allowed"],
  INTERNAL: [500, "INTERNAL_ERROR", "خطای داخلی", "Internal error"],
};
const err = (code, extra = {}, reqId) => {
  const [status, c, fa, en] = ERR[code] || ERR.INTERNAL;
  return json({ ok: false, error: { code: c, message: { fa, en }, ...extra } }, { status }, reqId);
};

/* ------------------------------ upstream fetch -------------------------- */
class UpErr extends Error { constructor(m, s, k = "net") { super(m); this.status = s; this.kind = k; } }
async function fetchJson(url, timeout = 10000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort("timeout"), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow",
      headers: { "User-Agent": "MusicWorker/2.0", Accept: "application/json" } });
    if (!r.ok) throw new UpErr("HTTP " + r.status, r.status, "http");
    return await r.json();
  } catch (e) {
    if (e instanceof UpErr) throw e;
    if (ac.signal.aborted) throw new UpErr("timeout", 504, "timeout");
    throw new UpErr(e.message || "net", 0, "net");
  } finally { clearTimeout(t); }
}
class Circuit {
  constructor(name) { this.name = name; this.f = 0; this.at = 0; }
  open() { if (this.f < 4) return false; if (Date.now() - this.at > 30000) { this.f = 0; return false; } return true; }
  async call(fn) {
    if (this.open()) throw new UpErr(this.name + " circuit", 503, "circuit");
    try { const r = await fn(); this.f = 0; return r; }
    catch (e) { this.f++; this.at = Date.now(); throw e; }
  }
}

/* ------------------------------- providers ------------------------------ */
function track(t) {
  const seen = new Set();
  const downloads = (t.downloads || []).filter(Boolean).map((d, i) => {
    let label = d.label && String(d.label).trim() ? String(d.label).trim() : `option-${i + 1}`;
    while (seen.has(label)) label = `${label}-${i + 1}`;
    seen.add(label);
    return { label, url: d.url };
  });
  return { ...t, downloadable: downloads.length > 0 && t.downloadable !== false, downloads };
}

const deezer = {
  name: "deezer", configured: true,
  async search(q, o) {
    const d = await fetchJson(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${o.limit}`, o.timeout);
    return (d.data || []).map(m => track({
      id: "dz_" + m.id, source: "deezer", title: m.title, artist: m.artist?.name || null,
      duration_ms: (m.duration || 0) * 1000, cover: m.album?.cover_medium || m.album?.cover || null,
      preview_url: m.preview || null, page_url: m.link, downloadable: false, downloads: [], license: "preview" }));
  },
  async get(id, o) {
    const m = await fetchJson("https://api.deezer.com/track/" + id.replace(/^dz_/, ""), o.timeout);
    if (m.error) return null;
    return track({ id: "dz_" + m.id, source: "deezer", title: m.title, artist: m.artist?.name,
      duration_ms: (m.duration || 0) * 1000, cover: m.album?.cover_medium || m.album?.cover,
      preview_url: m.preview, page_url: m.link, downloadable: false, downloads: [], license: "preview" });
  },
  async health(o) { await fetchJson("https://api.deezer.com/infos", o.timeout); return true; },
};

const itunes = {
  name: "itunes", configured: true,
  async search(q, o) {
    const d = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${o.limit}`, o.timeout);
    return (d.results || []).map(m => track({
      id: "it_" + m.trackId, source: "itunes", title: m.trackName, artist: m.artistName,
      duration_ms: m.trackTimeMillis, cover: m.artworkUrl100, preview_url: m.previewUrl,
      page_url: m.trackViewUrl, downloadable: false, downloads: [], license: "preview" }));
  },
  async get(id, o) {
    const d = await fetchJson("https://itunes.apple.com/lookup?id=" + id.replace(/^it_/, "") + "&entity=song", o.timeout);
    const m = (d.results || [])[0]; if (!m) return null;
    return track({ id: "it_" + m.trackId, source: "itunes", title: m.trackName, artist: m.artistName,
      duration_ms: m.trackTimeMillis, cover: m.artworkUrl100, preview_url: m.previewUrl,
      page_url: m.trackViewUrl, downloadable: false, downloads: [], license: "preview" });
  },
  async health(o) { await fetchJson("https://itunes.apple.com/search?term=t&limit=1", o.timeout); return true; },
};

const openverse = {
  name: "openverse", configured: true,
  async search(q, o) {
    const d = await fetchJson(`https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&page_size=${o.limit}&page=${o.page}`, o.timeout);
    return (d.results || []).map(m => track({
      id: "ov_" + m.id, source: "openverse", title: m.title, artist: m.creator,
      duration_ms: m.duration, cover: m.thumbnail || null, preview_url: m.url,
      page_url: m.foreign_landing_url, downloadable: true,
      downloads: m.url ? [{ label: m.filetype ? m.filetype.toUpperCase() : "audio", url: m.url }] : [],
      license: m.license || "cc" }));
  },
  async get(id, o) {
    const m = await fetchJson("https://api.openverse.org/v1/audio/" + id.replace(/^ov_/, "") + "/", o.timeout);
    if (!m || !m.id) return null;
    return track({ id: "ov_" + m.id, source: "openverse", title: m.title, artist: m.creator,
      duration_ms: m.duration, cover: m.thumbnail, preview_url: m.url, page_url: m.foreign_landing_url,
      downloadable: !!m.url, downloads: m.url ? [{ label: m.filetype ? m.filetype.toUpperCase() : "audio", url: m.url }] : [],
      license: m.license || "cc" });
  },
  async health(o) { await fetchJson("https://api.openverse.org/v1/audio/?q=t&page_size=1", o.timeout); return true; },
};

const iarchive = {
  name: "archive", configured: true,
  async search(q, o) {
    const p = new URLSearchParams({ q: q + " AND mediatype:audio", fl: "identifier,title,creator",
      rows: String(o.limit), page: String(o.page), output: "json" });
    const d = await fetchJson("https://archive.org/advancedsearch.php?" + p, o.timeout);
    return (d.response?.docs || []).map(m => track({
      id: "ia_" + m.identifier, source: "archive",
      title: Array.isArray(m.title) ? m.title[0] : m.title,
      artist: Array.isArray(m.creator) ? m.creator[0] : m.creator, duration_ms: null,
      cover: `https://archive.org/services/img/${m.identifier}`, preview_url: null,
      page_url: `https://archive.org/details/${m.identifier}`, downloadable: true,
      downloads: [{ label: "files", url: `https://archive.org/metadata/${m.identifier}` }], license: "public" }));
  },
  async get(id, o) {
    const mid = id.replace(/^ia_/, "");
    const d = await fetchJson("https://archive.org/metadata/" + mid, o.timeout);
    if (!d || !d.metadata) return null;
    const meta = d.metadata;
    const files = (d.files || []).filter(f => /\.(mp3|ogg|flac|m4a|wav)$/i.test(f.name || "") ||
      /(MP3|Ogg|FLAC|VBR|64Kbps|128Kbps)/i.test(f.format || ""));
    const downloads = files.slice(0, 8).map((f, i) => ({
      label: f.format ? String(f.format) : `option-${i + 1}`,
      url: `https://archive.org/download/${mid}/${encodeURIComponent(f.name)}` }));
    return track({ id: "ia_" + mid, source: "archive",
      title: Array.isArray(meta.title) ? meta.title[0] : meta.title,
      artist: Array.isArray(meta.creator) ? meta.creator[0] : meta.creator, duration_ms: null,
      cover: `https://archive.org/services/img/${mid}`, preview_url: downloads[0]?.url || null,
      page_url: `https://archive.org/details/${mid}`, downloadable: downloads.length > 0,
      downloads, license: "public" });
  },
  async health(o) { await fetchJson("https://archive.org/advancedsearch.php?q=t&rows=1&output=json", o.timeout); return true; },
};

function makeJamendo(cid) {
  return { name: "jamendo", configured: !!cid,
    async search(q, o) {
      if (!cid) return [];
      const p = new URLSearchParams({ client_id: cid, format: "json", limit: String(o.limit), search: q });
      const d = await fetchJson("https://api.jamendo.com/v3.0/tracks/?" + p, o.timeout);
      return (d.results || []).map(m => track({ id: "jm_" + m.id, source: "jamendo", title: m.name,
        artist: m.artist_name, duration_ms: (m.duration || 0) * 1000, cover: m.album_image || m.image,
        preview_url: m.audio, page_url: m.shareurl,
        downloadable: !!m.audiodownload_allowed && !!m.audiodownload,
        downloads: m.audiodownload_allowed && m.audiodownload ? [{ label: "MP3", url: m.audiodownload }] : [],
        license: m.license_ccurl || "cc" }));
    },
    async get(id, o) {
      if (!cid) return null;
      const d = await fetchJson(`https://api.jamendo.com/v3.0/tracks/?client_id=${cid}&format=json&id=${id.replace(/^jm_/, "")}`, o.timeout);
      const m = (d.results || [])[0]; if (!m) return null;
      return track({ id: "jm_" + m.id, source: "jamendo", title: m.name, artist: m.artist_name,
        duration_ms: (m.duration || 0) * 1000, cover: m.album_image || m.image, preview_url: m.audio,
        page_url: m.shareurl, downloadable: !!m.audiodownload_allowed && !!m.audiodownload,
        downloads: m.audiodownload_allowed && m.audiodownload ? [{ label: "MP3", url: m.audiodownload }] : [],
        license: m.license_ccurl || "cc" });
    },
    async health(o) { if (!cid) return false; await fetchJson(`https://api.jamendo.com/v3.0/tracks/?client_id=${cid}&format=json&limit=1`, o.timeout); return true; } };
}

// SoundCloud: client_id from secret, or auto-scraped from the site (like the
// original). Cached in KV (or module memory) for ~1h.
let _scCid = null;
async function scClientId(cfg, kv) {
  if (cfg.soundcloudClientId) return cfg.soundcloudClientId;
  if (kv) { try { const c = await kv.get("sc:cid"); if (c) return c; } catch {} }
  if (_scCid) return _scCid;
  const h = await (await fetch("https://soundcloud.com/", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } })).text();
  const assets = [...h.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^."]+\.js)"/g)];
  if (!assets.length) throw new UpErr("no sc assets", 0, "net");
  const ac = await (await fetch(assets[assets.length - 1][1])).text();
  const ids = [...ac.matchAll(/[,{]client_id:"([^"]+)"/g)];
  if (!ids.length) throw new UpErr("no sc cid", 0, "net");
  _scCid = ids[ids.length - 1][1];
  if (kv) try { await kv.put("sc:cid", _scCid, { expirationTtl: 3600 }); } catch {}
  return _scCid;
}
// Resolve the playable progressive stream URL for a track.
async function scStreamUrl(m, cid, timeout) {
  const tr = (m.media?.transcodings || []).find(t => t.format?.protocol === "progressive")
    || (m.media?.transcodings || [])[0];
  if (!tr) return null;
  try {
    const p = new URLSearchParams({ client_id: cid, track_authorization: m.track_authorization || "" });
    const d = await fetchJson(tr.url + "?" + p, timeout);
    return d.url || null;
  } catch { return null; }
}

function makeSoundCloud(cfg, kv) {
  const norm = m => track({ id: "sc_" + m.id, source: "soundcloud", title: m.title,
    artist: m.user?.username, duration_ms: m.duration,
    cover: (m.artwork_url || m.user?.avatar_url || "").replace("large", "t500x500") || null,
    preview_url: m.streamable ? `scstream_${m.id}` : null,
    page_url: m.permalink_url,
    description: m.description || null,
    genre: m.genre || null,
    downloadable: !!m.downloadable && !!m.download_url,
    downloads: m.downloadable && m.download_url ? [{ label: "original", url: `scdl_${m.id}` }] : [],
    license: m.license || "all-rights-reserved",
    _sc: m });
  return { name: "soundcloud", configured: true,
    async search(q, o) {
      const cid = await scClientId(cfg, kv);
      const p = new URLSearchParams({ q, client_id: cid, limit: String(o.limit), offset: String((o.page - 1) * o.limit), linked_partitioning: "1" });
      const d = await fetchJson("https://api-v2.soundcloud.com/search/tracks?" + p, o.timeout);
      return (d.collection || []).filter(m => m.kind === "track").map(norm);
    },
    async get(id, o) {
      const cid = await scClientId(cfg, kv);
      const m = await fetchJson(`https://api-v2.soundcloud.com/tracks/${id.replace(/^sc_/, "")}?client_id=${cid}`, o.timeout);
      return m && m.id ? norm(m) : null;
    },
    // Resolve a playable URL for preview or download on demand.
    async resolve(id, o) {
      const cid = await scClientId(cfg, kv);
      const m = await fetchJson(`https://api-v2.soundcloud.com/tracks/${id}?client_id=${cid}`, o.timeout);
      if (!m || !m.id) return null;
      return await scStreamUrl(m, cid, o.timeout);
    },
    async health(o) { try { return !!(await scClientId(cfg, kv)); } catch { return false; } } };
}

function buildProviders(cfg, kv) {
  const list = [deezer, itunes, openverse, iarchive, makeJamendo(cfg.jamendoClientId), makeSoundCloud(cfg, kv)];
  const brk = {}; for (const p of list) brk[p.name] = new Circuit(p.name);
  return { list, brk };
}
const dedupKey = t => `${(t.title || "").toLowerCase()}|${(t.artist || "").toLowerCase()}`.slice(0, 120);

async function searchAll(prov, q, { source, page, timeout, perPage = 12 }) {
  const qn = normalizeQuery(q);
  const active = prov.list.filter(p => p.configured && (!source || source === "all" || p.name === source));
  const settled = await Promise.allSettled(active.map(p =>
    prov.brk[p.name].call(() => p.search(qn, { timeout, limit: perPage, page }))));
  const merged = [], seen = new Set(), errors = {};
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      for (const t of r.value) { const k = dedupKey(t); if (!seen.has(k)) { seen.add(k); merged.push(t); } }
    } else errors[active[i].name] = r.reason instanceof UpErr ? r.reason.kind : "err";
  });
  merged.sort((a, b) => (b.downloadable - a.downloadable));
  return { results: merged, errors, query: qn };
}
function findProvider(prov, id) {
  const map = { dz: "deezer", it: "itunes", ov: "openverse", ia: "archive", jm: "jamendo", sc: "soundcloud" };
  const name = map[(id || "").split("_")[0]];
  return prov.list.find(p => p.name === name) || null;
}

/* ------------------------------ SSRF proxy ------------------------------ */
const AUDIO = /^audio\//i, IMAGE = /^image\//i;
class PErr extends Error { constructor(m, s) { super(m); this.status = s; } }
function isPrivate(host) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) { const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127)) return true; }
  return false;
}
function validateMediaUrl(raw, cfg) {
  let u; try { u = new URL(raw); } catch { return { ok: false }; }
  if (u.protocol !== "https:") return { ok: false };
  if ((u.port || "443") !== "443") return { ok: false };
  if (isPrivate(u.hostname)) return { ok: false };
  if (!hostMatch(u.hostname, cfg.cdnAllow)) return { ok: false };
  return { ok: true, url: u };
}
async function fetchUpstream(url, cfg, request, maxHops = 3) {
  let cur = url;
  const range = request.headers.get("Range");
  for (let hop = 0; hop <= maxHops; hop++) {
    const v = validateMediaUrl(cur, cfg);
    if (!v.ok) throw new PErr("blocked", 403);
    const headers = { "User-Agent": "MusicWorker/2.0" };
    if (range) headers.Range = range;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort("timeout"), cfg.upstreamTimeoutMs);
    let res;
    try { res = await fetch(v.url.toString(), { redirect: "manual", headers, signal: ac.signal }); }
    finally { clearTimeout(t); }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location");
      if (!loc) throw new PErr("bad redirect", 502);
      cur = new URL(loc, v.url).toString(); continue;
    }
    return res;
  }
  throw new PErr("redirects", 502);
}
function capStream(stream, max) {
  if (!stream) return stream;
  const rd = stream.getReader(); let sent = 0;
  return new ReadableStream({ async pull(c) {
    const { done, value } = await rd.read();
    if (done) return c.close();
    sent += value.byteLength;
    if (sent > max) { c.error(new PErr("too large", 413)); rd.cancel(); return; }
    c.enqueue(value);
  }, cancel() { rd.cancel(); } });
}
async function proxyMedia(target, cfg, request, kind) {
  let res;
  try { res = await fetchUpstream(target, cfg, request); }
  catch (e) { return e instanceof PErr ? err("BLOCKED_URL", { detail: e.message }) : err("UPSTREAM", {}); }
  if (!res.ok && res.status !== 206) return err("UPSTREAM", { upstream_status: res.status });
  const ct = res.headers.get("Content-Type") || "";
  if (!(kind === "audio" ? AUDIO : IMAGE).test(ct)) return err("BLOCKED_URL", { detail: "content-type" });
  const max = cfg.maxDownloadMB * 1024 * 1024;
  const cl = parseInt(res.headers.get("Content-Length") || "0", 10);
  if (cl > max) return err("TOO_LARGE", { max_mb: cfg.maxDownloadMB });
  const h = new Headers();
  h.set("Content-Type", ct); h.set("X-Content-Type-Options", "nosniff");
  h.set("Cache-Control", "public, max-age=300");
  if (res.headers.get("Accept-Ranges")) h.set("Accept-Ranges", res.headers.get("Accept-Ranges"));
  if (res.headers.get("Content-Range")) h.set("Content-Range", res.headers.get("Content-Range"));
  if (cl) h.set("Content-Length", String(cl));
  return new Response(capStream(res.body, max), { status: res.status === 206 ? 206 : 200, headers: h });
}

/* --------------------------------- KV ----------------------------------- */
async function rateLimit(kv, key, limit, win) {
  if (!kv) return { allowed: true };
  const now = Math.floor(Date.now() / 1000), w = Math.floor(now / win), k = `rl:${key}:${w}`;
  try { const n = parseInt((await kv.get(k)) || "0", 10);
    if (n >= limit) return { allowed: false, retry: win - (now % win) };
    await kv.put(k, String(n + 1), { expirationTtl: win * 2 });
  } catch {}
  return { allowed: true };
}

/* --------------------------------- i18n --------------------------------- */
const STR = {
  fa: { dir: "rtl", lang: "fa", title: "جستجو و دانلود موسیقی",
    tagline: "جستجوی همزمان در منابع قانونی موسیقی با پیش‌نمایش و دانلود",
    ph: "نام آهنگ، هنرمند یا آلبوم…", btn: "جستجو", all: "همهٔ منابع",
    howT: "چطور کار می‌کند؟",
    howB: "این سرویس در چند منبع قانونی (Deezer، iTunes، Openverse، Internet Archive و در صورت تنظیم Jamendo و SoundCloud) جستجو می‌کند و نتایج را ادغام و تکراری‌ها را حذف می‌کند. پیش‌نمایش برای همه فعال است؛ دانلود فقط جایی که منبع اجازه دهد.",
    iran: "توجه: کاتالوگ هنرمندان ایرانی در این منابع قانونی محدود است؛ ممکن است همهٔ آهنگ‌های ایرانی پیدا نشوند.",
    prev: "پیش‌نمایش", dl: "دانلود", open: "باز کردن در منبع", details: "جزئیات",
    loading: "در حال جستجو…", none: "چیزی پیدا نشد", net: "خطای شبکه؛ دوباره تلاش کنید",
    apiT: "مستندات API", faqT: "سؤالات متداول", termsT: "قوانین و حذف محتوا",
    termsB: "این سرویس فقط به منابع عمومی و قانونی متصل می‌شود و هیچ فایلی را میزبانی نمی‌کند. حق نشر هر اثر متعلق به صاحب آن است.",
    foot: "ساخته‌شده توسط علی موسوی (AliMsvD)", lang: "English", dur: "مدت", lic: "مجوز",
    desc: "توضیحات", genre: "سبک", opts: "گزینه‌های دانلود", close: "بستن", artist: "هنرمند",
    errT: "کدهای خطا", code: "کد", mean: "معنی",
    faq: [["چرا بعضی آهنگ‌ها دانلود ندارند؟","چون منبع اجازهٔ دانلود نمی‌دهد."],
          ["آیا فایل‌ها نگه‌داری می‌شوند؟","خیر؛ همه از CDN منبع پخش می‌شوند."],
          ["چرا آهنگ ایرانی کم هست؟","منابع قانونی بین‌المللی کاتالوگ محدودی از موسیقی ایرانی دارند."]] },
  en: { dir: "ltr", lang: "en", title: "Music Search & Download",
    tagline: "Search legal music sources at once, preview and download",
    ph: "Song, artist or album…", btn: "Search", all: "All sources",
    howT: "How it works",
    howB: "Queries several legal sources (Deezer, iTunes, Openverse, Internet Archive, and if configured Jamendo & SoundCloud), merges and de-duplicates. Preview for all; download only where allowed.",
    iran: "Note: the catalog of Iranian artists in these legal sources is limited.",
    prev: "Preview", dl: "Download", open: "Open at source", details: "Details",
    loading: "Searching…", none: "Nothing found", net: "Network error; retry",
    apiT: "API Docs", faqT: "FAQ", termsT: "Terms & Takedown",
    termsB: "Only connects to public, legal sources; hosts no files. Copyright belongs to owners.",
    foot: "Built by Ali Mousavi (AliMsvD)", lang: "فارسی", dur: "Duration", lic: "License",
    desc: "Description", genre: "Genre", opts: "Download options", close: "Close", artist: "Artist",
    errT: "Error codes", code: "Code", mean: "Meaning",
    faq: [["Why no download on some?","The source doesn't allow it."],
          ["Are files stored?","No; all stream from source CDNs."],
          ["Why few Iranian tracks?","Limited Persian catalog in international legal sources."]] },
};
const ERRROWS = [["BAD_REQUEST","پارامتر نامعتبر","Invalid parameter"],["NOT_FOUND","پیدا نشد","Not found"],
  ["UNAUTHORIZED","احراز هویت لازم","Auth required"],["RATE_LIMITED","بیش از حد","Rate limit"],
  ["UPSTREAM_ERROR","خطای منبع","Upstream error"],["UPSTREAM_TIMEOUT","مهلت","Timeout"],
  ["PAYLOAD_TOO_LARGE","حجم زیاد","Too large"],["BLOCKED_URL","نشانی مسدود","Blocked"],
  ["NOT_DOWNLOADABLE","دانلود مجاز نیست","No download"],["INTERNAL_ERROR","خطای داخلی","Internal"]];

/* --------------------------------- UI ----------------------------------- */
function renderPage(lang, nonce) {
  const s = STR[lang] || STR.fa;
  const errRows = ERRROWS.map(([c, fa, en]) =>
    `<tr><td><code>${c}</code></td><td>${esc(lang === "fa" ? fa : en)}</td></tr>`).join("");
  const faq = s.faq.map(([q, a]) =>
    `<details class="reveal"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("");
  return `<!DOCTYPE html>
<html lang="${s.lang}" dir="${s.dir}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.title)}</title><meta name="description" content="${esc(s.tagline)}">
<script nonce="${nonce}">
try{if("IntersectionObserver"in window&&!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("js")}catch(e){}
setTimeout(function(){document.querySelectorAll(".reveal").forEach(function(n){n.style.opacity=1;n.style.transform="none"})},1000);
</script>
<style nonce="${nonce}">
:root{--bg:#f4f6fb;--fg:#131520;--card:#fff;--mut:#6b7280;--acc:#5b5bd6;--acc2:#8b5cf6;--bd:#e5e7eb;--sh:0 4px 24px rgba(0,0,0,.06)}
@media(prefers-color-scheme:dark){:root{--bg:#0b0d13;--fg:#e8eaf0;--card:#151823;--mut:#9aa3b2;--acc:#8b8bf0;--acc2:#a78bfa;--bd:#262c3a;--sh:0 4px 24px rgba(0,0,0,.4)}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;line-height:1.7}
.wrap{max-width:920px;margin:0 auto;padding:1rem}
header{display:flex;align-items:center;justify-content:space-between;padding:1rem}
.brand{font-weight:800;font-size:1.15rem;background:linear-gradient(90deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
.burger{cursor:pointer;background:none;border:1px solid var(--bd);border-radius:.5rem;padding:.4rem .7rem;color:var(--fg);font-size:1.1rem}
nav{display:none;gap:1rem;padding:0 1rem}nav.open{display:flex;flex-direction:column}
nav a{color:var(--fg);text-decoration:none;padding:.3rem 0}
.hero{text-align:center;padding:3rem 1rem 2rem}.hero h1{font-size:2.1rem;margin:0 0 .5rem;font-weight:800}
.hero p{color:var(--mut)}
.search{display:flex;gap:.5rem;max-width:600px;margin:1rem auto}
.search input{flex:1;padding:.85rem 1rem;border:1px solid var(--bd);border-radius:.9rem;background:var(--card);color:var(--fg);font-size:1rem;box-shadow:var(--sh)}
.search select{padding:.85rem;border:1px solid var(--bd);border-radius:.9rem;background:var(--card);color:var(--fg)}
.btn{background:linear-gradient(90deg,var(--acc),var(--acc2));color:#fff;border:none;border-radius:.9rem;padding:.85rem 1.3rem;font-size:1rem;cursor:pointer;font-weight:600}
.btn.ghost{background:transparent;color:var(--acc);border:1px solid var(--acc);font-weight:500}
.btn.mini{padding:.4rem .8rem;font-size:.82rem;border-radius:.6rem}
.note{font-size:.85rem;color:var(--mut);background:var(--card);border:1px solid var(--bd);border-radius:.9rem;padding:.6rem 1rem;max-width:600px;margin:0 auto}
.grid{display:grid;gap:1.1rem;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));margin-top:1.5rem}
.card{background:var(--card);border:1px solid var(--bd);border-radius:1.1rem;overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--sh);transition:transform .25s,box-shadow .25s}
.card:hover{transform:translateY(-4px)}
.card img{width:100%;aspect-ratio:1;object-fit:cover;background:var(--bd);cursor:pointer}
.card .b{padding:.9rem;display:flex;flex-direction:column;gap:.4rem;flex:1}
.card .t{font-weight:700;font-size:.98rem}
.card .a{color:var(--mut);font-size:.88rem}
.badges{display:flex;gap:.4rem;flex-wrap:wrap}
.badge{font-size:.68rem;background:var(--bg);border:1px solid var(--bd);border-radius:1rem;padding:.15rem .6rem;color:var(--mut);text-transform:capitalize}
.actions{margin-top:auto;display:flex;gap:.5rem;flex-wrap:wrap}
.actions .btn,.actions a{font-size:.85rem;padding:.55rem .7rem;flex:1;text-align:center;text-decoration:none;border-radius:.7rem}
.actions a{background:transparent;color:var(--acc);border:1px solid var(--acc)}
section{padding:2rem 1rem}section h2{font-size:1.4rem;margin-bottom:.8rem;font-weight:800}
details{background:var(--card);border:1px solid var(--bd);border-radius:.9rem;padding:.8rem 1rem;margin-bottom:.6rem}
summary{cursor:pointer;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{border:1px solid var(--bd);padding:.5rem .7rem;text-align:start}
pre{overflow:auto;background:var(--card);border:1px solid var(--bd);border-radius:.9rem;padding:1rem;direction:ltr;text-align:left;font-size:.82rem}
footer{border-top:1px solid var(--bd);text-align:center;padding:2rem 1rem;color:var(--mut);font-size:.85rem}
footer a{color:var(--acc);text-decoration:none}
audio{width:100%;margin-top:.4rem}
[hidden]{display:none!important}
/* Detail modal */
.modal{position:fixed;inset:0;background:rgba(10,10,15,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:1rem;z-index:50;opacity:0;pointer-events:none;transition:opacity .25s}
.modal.open{opacity:1;pointer-events:auto}
.modal .box{background:var(--card);border:1px solid var(--bd);border-radius:1.2rem;max-width:640px;width:100%;max-height:88vh;overflow:auto;transform:translateY(14px);transition:transform .25s}
.modal.open .box{transform:none}
.modal .hd{display:flex;gap:1rem;padding:1.2rem}
.modal .hd img{width:130px;height:130px;border-radius:1rem;object-fit:cover;flex-shrink:0}
.modal .hd .ti{flex:1;min-width:0}
.modal .hd h3{margin:.1rem 0 .3rem;font-size:1.15rem}
.modal .hd .ar{color:var(--mut)}
.modal .x{position:sticky;top:.6rem;float:inline-end;background:var(--bg);border:1px solid var(--bd);border-radius:.6rem;padding:.2rem .7rem;cursor:pointer;color:var(--fg);font-size:1.1rem}
.modal .bd{padding:0 1.2rem 1.2rem}
.modal .desc{font-size:.9rem;color:var(--mut);white-space:pre-wrap;max-height:160px;overflow:auto;background:var(--bg);border-radius:.8rem;padding:.8rem;margin:.8rem 0}
.dlrow{display:flex;justify-content:space-between;align-items:center;border:1px solid var(--bd);border-radius:.8rem;padding:.6rem .9rem;margin:.5rem 0}
.dlrow .l{font-size:.85rem;font-weight:600}
html.js .reveal{opacity:0;transform:translateY(14px);transition:opacity .6s ease,transform .6s ease}
html.js .reveal.in{opacity:1;transform:none}
#dbg{position:fixed;inset-inline:0;bottom:0;max-height:40vh;overflow:auto;background:#3a0d0d;color:#ffd9d9;font-size:.75rem;padding:.5rem;display:none;z-index:99;direction:ltr}
@media(max-width:560px){.search{flex-direction:column}.hero h1{font-size:1.5rem}.modal .hd{flex-direction:column}.modal .hd img{width:100%;height:auto}}
</style>
</head>
<body>
<div id="dbg" aria-hidden="true"></div>
<header>
  <div class="brand">🎵 ${esc(s.title)}</div>
  <div>
    <a class="btn ghost" href="?lang=${lang === "fa" ? "en" : "fa"}">${esc(s.lang)}</a>
    <button class="burger" id="burger" aria-label="menu" aria-expanded="false">☰</button>
  </div>
</header>
<nav id="nav">
  <a href="#how">${esc(s.howT)}</a><a href="#api">${esc(s.apiT)}</a>
  <a href="#faq">${esc(s.faqT)}</a><a href="#terms">${esc(s.termsT)}</a>
</nav>
<div class="wrap">
  <div class="hero reveal">
    <h1>${esc(s.title)}</h1><p>${esc(s.tagline)}</p>
    <form class="search" id="sform" action="/api/v1/search" method="get">
      <input type="search" name="q" placeholder="${esc(s.ph)}" required autocomplete="off" id="q">
      <select name="source" id="src">
        <option value="all">${esc(s.all)}</option><option value="deezer">Deezer</option>
        <option value="itunes">iTunes</option><option value="openverse">Openverse</option>
        <option value="archive">Internet Archive</option><option value="jamendo">Jamendo</option>
        <option value="soundcloud">SoundCloud</option>
      </select>
      <button class="btn" type="submit">${esc(s.btn)}</button>
    </form>
    <p class="note">${esc(s.iran)}</p>
  </div>
  <div id="results" aria-live="polite"></div>
  <section id="how" class="reveal"><h2>${esc(s.howT)}</h2><p>${esc(s.howB)}</p></section>
  <section id="api" class="reveal"><h2>${esc(s.apiT)}</h2>
    <pre>GET /api/v1/search?q=QUERY&amp;source=all&amp;page=1
GET /api/v1/track?id=dz_123
GET /api/v1/download?id=ia_abc&amp;index=0
GET /api/v1/stream?url=...
GET /api/v1/cover?url=...
GET /health  ·  GET /openapi.json</pre>
    <pre>curl "https://&lt;host&gt;/api/v1/search?q=test"
fetch('/api/v1/search?q=test').then(r=>r.json())</pre>
    <h3>${esc(s.errT)}</h3>
    <table><thead><tr><th>${esc(s.code)}</th><th>${esc(s.mean)}</th></tr></thead><tbody>${errRows}</tbody></table>
  </section>
  <section id="faq" class="reveal"><h2>${esc(s.faqT)}</h2>${faq}</section>
  <section id="terms" class="reveal"><h2>${esc(s.termsT)}</h2><p>${esc(s.termsB)}</p></section>
</div>
<footer>${esc(s.foot)} · <a href="https://t.me/AliMsvD" rel="noopener">t.me/AliMsvD</a></footer>
<div class="modal" id="modal" role="dialog" aria-modal="true"><div class="box">
<button class="x" id="mx">${esc(s.close)} ✕</button>
<div class="hd"><img id="mimg" alt=""><div class="ti"><h3 id="mtitle"></h3><div class="ar" id="martist"></div><div class="badges" id="mbadges"></div></div></div>
<div class="bd"><div id="mdesc"></div><div id="mplayer"></div><div id="mdl"></div><div id="mlink"></div></div>
</div></div>
<script nonce="${nonce}">
(function(){"use strict";
var L=${JSON.stringify(lang)},T={loading:${JSON.stringify(s.loading)},none:${JSON.stringify(s.none)},
net:${JSON.stringify(s.net)},prev:${JSON.stringify(s.prev)},dl:${JSON.stringify(s.dl)},open:${JSON.stringify(s.open)},
details:${JSON.stringify(s.details)},desc:${JSON.stringify(s.desc)},opts:${JSON.stringify(s.opts)}};
var DATA={};
function show(m){try{var d=document.getElementById('dbg');if(location.search.indexOf('debug=1')>-1){d.style.display='block';d.textContent+=m+'\n'}}catch(e){}}
window.addEventListener('error',function(e){show('ERR: '+e.message+' @'+e.lineno)});
try{var b=document.getElementById('burger'),n=document.getElementById('nav');
if(b)b.addEventListener('click',function(){n.classList.toggle('open');b.setAttribute('aria-expanded',n.classList.contains('open'))})}catch(e){show(e.message)}
try{if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target)}})},{threshold:.1});
document.querySelectorAll('.reveal').forEach(function(n){io.observe(n)})}else{document.querySelectorAll('.reveal').forEach(function(n){n.classList.add('in')})}}catch(e){show(e.message)}
function es(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
var modal=document.getElementById('modal');
document.getElementById('mx').addEventListener('click',function(){modal.classList.remove('open');var a=document.querySelector('#mplayer audio');if(a)a.pause()});
modal.addEventListener('click',function(e){if(e.target===modal){modal.classList.remove('open');var a=document.querySelector('#mplayer audio');if(a)a.pause()}});
function card(t){DATA[t.id]=t;
var b='<div class="card">';
if(t.cover)b+='<img loading="lazy" data-d="'+t.id+'" src="/api/v1/cover?url='+encodeURIComponent(t.cover)+'" alt="">';
b+='<div class="b"><div class="t">'+es(t.title)+'</div><div class="a">'+es(t.artist)+'</div><div class="badges"><span class="badge">'+es(t.source)+'</span>';
if(t.duration)b+='<span class="badge">'+t.duration+'</span>';if(t.license)b+='<span class="badge">'+es(t.license)+'</span>';
b+='</div><div class="actions">';
if(t.preview_url)b+='<button class="btn ghost mini" data-p="'+t.id+'">'+T.prev+'</button>';
b+='<button class="btn mini" data-d="'+t.id+'">'+T.details+'</button>';
b+='</div></div></div>';return b}
function openModal(id){var t=DATA[id];if(!t)return;
document.getElementById('mtitle').textContent=t.title||'';
document.getElementById('martist').textContent=t.artist||'';
var img=document.getElementById('mimg');
if(t.cover){img.src='/api/v1/cover?url='+encodeURIComponent(t.cover);img.style.display=''}else img.style.display='none';
var bg='';if(t.source)bg+='<span class="badge">'+es(t.source)+'</span>';
if(t.duration)bg+='<span class="badge">'+t.duration+'</span>';
if(t.genre)bg+='<span class="badge">'+es(t.genre)+'</span>';
if(t.license)bg+='<span class="badge">'+es(t.license)+'</span>';
document.getElementById('mbadges').innerHTML=bg;
var dd=document.getElementById('mdesc');
dd.innerHTML=t.description?'<div class="desc">'+es(t.description)+'</div>':'';
document.getElementById('mplayer').innerHTML=t.preview_url?'<audio controls preload="none" src="/api/v1/stream?url='+encodeURIComponent(t.preview_url)+'"></audio>':'';
var dl=document.getElementById('mdl'),rows='';
if(t.downloadable&&t.options&&t.options.length){
 rows='<h4 style="margin:.6rem 0 .2rem">'+T.opts+'</h4>';
 t.options.forEach(function(lb,i){rows+='<div class="dlrow"><span class="l">'+es(lb)+'</span><a class="btn mini" href="/api/v1/download?id='+encodeURIComponent(t.id)+'&index='+i+'">'+T.dl+'</a></div>'});
}else if(t.page_url){
 rows='<div class="dlrow"><span class="l">'+es(t.source)+'</span><a class="btn mini ghost" href="'+t.page_url+'" target="_blank" rel="noopener">'+T.open+'</a></div>';
}
dl.innerHTML=rows;
modal.classList.add('open')}
try{var form=document.getElementById('sform'),out=document.getElementById('results');
form.addEventListener('submit',function(ev){ev.preventDefault();
var q=document.getElementById('q').value.trim();if(!q)return;
out.innerHTML='<p>'+T.loading+'</p>';
fetch('/api/v1/search?q='+encodeURIComponent(q)+'&source='+document.getElementById('src').value+'&lang='+L)
.then(function(r){return r.json()}).then(function(d){
out.innerHTML=(d.results&&d.results.length)?'<div class="grid">'+d.results.map(card).join('')+'</div>':'<p>'+T.none+'</p>'})
.catch(function(e){out.innerHTML='<p>'+T.net+'</p>';show(e.message)})});
out.addEventListener('click',function(e){
var d=e.target.closest('[data-d]');if(d){openModal(d.getAttribute('data-d'));return}
var b=e.target.closest('[data-p]');if(!b)return;
var id=b.getAttribute('data-p'),t=DATA[id];if(!t||!t.preview_url)return;
var a=b.parentElement.parentElement.querySelector('audio');
if(a){a.paused?a.play():a.pause();return}
a=document.createElement('audio');a.controls=true;a.preload='none';
a.src='/api/v1/stream?url='+encodeURIComponent(t.preview_url);b.parentElement.appendChild(a);a.play()})}catch(e){show(e.message)}
})();
</script>
</body>
</html>`;
}

function openapiSpec(base) {
  return { openapi: "3.0.3", info: { title: "Music Search & Download API", version: "2.0.0",
    description: "Aggregated legal music search with preview & download proxy." },
    servers: [{ url: base }],
    paths: {
      "/api/v1/search": { get: { summary: "Search tracks" } },
      "/api/v1/track": { get: { summary: "Track details" } },
      "/api/v1/download": { get: { summary: "Proxied download" } },
      "/api/v1/stream": { get: { summary: "Preview stream proxy (Range)" } },
      "/api/v1/cover": { get: { summary: "Cover image proxy" } },
      "/health": { get: { summary: "Health; ?deep=1 upstream checks" } } } };
}

/* -------------------------------- handler ------------------------------- */
const csp = n => `default-src 'none'; script-src 'nonce-${n}'; style-src 'nonce-${n}'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
const ckey = r => r.headers.get("CF-Connecting-IP") || "anon";
const authed = (r, c) => !c.apiKeys || c.apiKeys.includes(
  r.headers.get("x-api-key") || (r.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));

function present(t, base) {
  const prev = t.preview_url && t.preview_url.startsWith("scstream_")
    ? `${base}/api/v1/stream?url=${encodeURIComponent(t.preview_url)}` : t.preview_url;
  return { id: t.id, source: t.source, title: t.title, artist: t.artist,
    duration: t.duration_ms ? Math.round(t.duration_ms / 1000) + "s" : null,
    duration_ms: t.duration_ms || null,
    cover: t.cover, preview_url: prev, page_url: t.page_url,
    description: t.description || null, genre: t.genre || null,
    downloadable: t.downloadable,
    download: t.downloadable && t.downloads.length ? `${base}/api/v1/download?id=${encodeURIComponent(t.id)}&index=0` : null,
    options: t.downloads.map(d => d.label), license: t.license };
}

export default {
  async fetch(request, env) {
    const reqId = rid(), url = new URL(request.url), path = url.pathname;
    const cfg = getConfig(env), kv = env.CACHE_KV || null, prov = buildProviders(cfg, kv);
    try {
      // Web page / JSON summary
      if ((path === "/" || path === "") && (request.method === "GET" || request.method === "HEAD")) {
        const acc = request.headers.get("Accept") || "";
        if (/text\/html/.test(acc)) {
          const lang = url.searchParams.get("lang") === "en" ? "en" : "fa";
          const nonce = crypto.randomUUID().replace(/-/g, "");
          const html = renderPage(lang, nonce);
          const h = new Headers();
          h.set("Content-Type", "text/html; charset=utf-8");
          h.set("Content-Security-Policy", csp(nonce));
          h.set("X-Content-Type-Options", "nosniff");
          h.set("X-Frame-Options", "DENY");
          h.set("Cache-Control", "private, no-store");
          return new Response(request.method === "HEAD" ? null : html, { headers: h });
        }
        return json({ name: "Music Search & Download API", version: "2.0.0", docs: "/openapi.json",
          endpoints: ["/api/v1/search", "/api/v1/track", "/api/v1/download", "/api/v1/stream", "/api/v1/cover", "/health", "/openapi.json"] }, {}, reqId);
      }

      if (path === "/health" && request.method === "GET") {
        const deep = url.searchParams.get("deep") === "1", providers = {};
        for (const p of prov.list) {
          providers[p.name] = { configured: !!p.configured, healthy: true };
          if (!p.configured) providers[p.name].healthy = false;
          else if (deep) { try { providers[p.name].healthy = await p.health({ timeout: cfg.upstreamTimeoutMs }); } catch { providers[p.name].healthy = false; } }
        }
        return json({ status: "ok", kv: !!kv, providers }, {}, reqId);
      }

      if (path === "/openapi.json" && request.method === "GET")
        return json(openapiSpec(url.origin), {}, reqId);

      if (path.startsWith("/api/v1/")) {
        if (!authed(request, cfg)) return err("UNAUTHORIZED", {}, reqId);
        const isMedia = /stream|cover|download/.test(path);
        const rl = await rateLimit(kv, (isMedia ? "m" : "s") + ":" + ckey(request),
          isMedia ? cfg.rateMedia : cfg.rateSearch, cfg.rateWindowSec);
        if (!rl.allowed) return err("RATE_LIMITED", { retry_after: rl.retry }, reqId);

        if (path === "/api/v1/search") {
          const q = url.searchParams.get("q");
          if (!q || !q.trim()) return err("BAD_REQUEST", { param: "q" }, reqId);
          const source = url.searchParams.get("source") || "all";
          const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
          const ck = `s:${normalizeQuery(q)}:${source}:${page}`;
          if (kv) { try { const c = await kv.get(ck, "json"); if (c) return json(c, {}, reqId); } catch {} }
          const { results, errors } = await searchAll(prov, q, { source, page, timeout: cfg.upstreamTimeoutMs });
          const body = { query: q, page, count: results.length,
            results: results.map(t => present(t, url.origin)),
            errors: Object.keys(errors).length ? errors : undefined };
          if (kv) try { await kv.put(ck, JSON.stringify(body), { expirationTtl: cfg.cacheTTL }); } catch {}
          const res = json(body, {}, reqId);
          res.headers.set("Cache-Control", `public, max-age=${cfg.cacheTTL}`);
          return res;
        }

        if (path === "/api/v1/track") {
          const id = url.searchParams.get("id");
          if (!id) return err("BAD_REQUEST", { param: "id" }, reqId);
          const p = findProvider(prov, id);
          if (!p || !p.configured) return err("NOT_FOUND", { id }, reqId);
          let t; try { t = await p.get(id, { timeout: cfg.upstreamTimeoutMs }); }
          catch { return err("UPSTREAM", {}, reqId); }
          if (!t) return err("NOT_FOUND", { id }, reqId);
          return json({ track: { ...t, downloads: t.downloads.map(d => d.label) } }, {}, reqId);
        }

        if (path === "/api/v1/download") {
          const id = url.searchParams.get("id"), index = parseInt(url.searchParams.get("index") || "0", 10);
          if (!id) return err("BAD_REQUEST", { param: "id" }, reqId);
          const p = findProvider(prov, id);
          if (!p || !p.configured) return err("NOT_FOUND", { id }, reqId);
          let t; try { t = await p.get(id, { timeout: cfg.upstreamTimeoutMs }); }
          catch { return err("UPSTREAM", {}, reqId); }
          if (!t) return err("NOT_FOUND", { id }, reqId);
          let target;
          const dl = t.downloads[index] || t.downloads[0];
          if (dl && dl.url && dl.url.startsWith("scdl_")) {
            // resolve progressive stream as the downloadable file
            try { target = await p.resolve(dl.url.replace("scdl_", ""), { timeout: cfg.upstreamTimeoutMs }); }
            catch { return err("UPSTREAM", {}, reqId); }
            if (!target) return err("NOT_DOWNLOADABLE", { id }, reqId);
          } else if (dl && dl.url) {
            target = dl.url;
          } else {
            return err("NOT_DOWNLOADABLE", { id }, reqId);
          }
          const res = await proxyMedia(target, cfg, request, "audio");
          if (res instanceof Response && res.ok) res.headers.set("Content-Disposition",
            `attachment; filename*=UTF-8''${encodeURIComponent((t.title || "track").replace(/[^\w؀-ۿ -]/g, "_"))}`);
          return res;
        }

        if (path === "/api/v1/stream") {
          const target = url.searchParams.get("url");
          if (!target) return err("BAD_REQUEST", { param: "url" }, reqId);
          // SoundCloud lazy stream resolution
          if (target.startsWith("scstream_")) {
            const sid = target.replace("scstream_", "");
            const sc = prov.list.find(p => p.name === "soundcloud");
            let u; try { u = await sc.resolve(sid, { timeout: cfg.upstreamTimeoutMs }); }
            catch { return err("UPSTREAM", {}, reqId); }
            if (!u) return err("NOT_FOUND", {}, reqId);
            return proxyMedia(u, cfg, request, "audio");
          }
          if (!validateMediaUrl(target, cfg).ok) return err("BLOCKED_URL", {}, reqId);
          return proxyMedia(target, cfg, request, "audio");
        }

        if (path === "/api/v1/cover") {
          const target = url.searchParams.get("url");
          if (!target) return err("BAD_REQUEST", { param: "url" }, reqId);
          if (!validateMediaUrl(target, cfg).ok) return err("BLOCKED_URL", {}, reqId);
          return proxyMedia(target, cfg, request, "image");
        }
        return err("NOT_FOUND", {}, reqId);
      }

      return err("NOT_FOUND", {}, reqId);
    } catch (e) {
      return err("INTERNAL", { detail: String(e && e.message || e) }, reqId);
    }
  },
};
