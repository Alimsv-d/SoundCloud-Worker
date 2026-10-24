/* ============================================================================
 * SoundCloud Music — single-file Cloudflare Worker
 * Search, preview & download from SoundCloud only (like the original).
 * Auto-scrapes client_id — no secrets needed. Persian-first RTL web app.
 * Deploy: paste this file into the Workers editor, or use the Deploy button.
 * ========================================================================== */

/* ------------------------------ text utils ------------------------------ */
const FA_D = "۰۱۲۳۴۵۶۷۸۹", AR_D = "٠١٢٣٤٥٦٧٨٩";
function normalizeQuery(s) {
  if (s == null) return "";
  let x = String(s)
    .replace(/ي|ى/g, "ی").replace(/ك/g, "ک")
    .replace(/[۰-۹]/g, c => FA_D.indexOf(c))
    .replace(/[٠-٩]/g, c => AR_D.indexOf(c))
    .replace(/[ً-ٟـ]/g, "");
  return x.replace(/\s+/g, " ").trim();
}
const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const toFaDigits = n => String(n).replace(/[0-9]/g, d => FA_D[d]);
function fmtDur(ms, fa) {
  if (!ms) return "";
  const s = Math.round(ms / 1000), m = Math.floor(s / 60), r = s % 60;
  const out = m + ":" + String(r).padStart(2, "0");
  return fa ? toFaDigits(out) : out;
}

/* -------------------------------- config -------------------------------- */
function getConfig(env) {
  const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    maxDownloadMB: num(env.MAX_DOWNLOAD_MB, 100),
    cacheTTL: num(env.CACHE_TTL_SECONDS, 300),
    upstreamTimeoutMs: num(env.UPSTREAM_TIMEOUT_MS, 12000),
    rateSearch: num(env.RATE_LIMIT_SEARCH, 40),
    rateMedia: num(env.RATE_LIMIT_MEDIA, 90),
    rateWindowSec: num(env.RATE_LIMIT_WINDOW_SEC, 60),
    apiKeys: env.API_KEYS ? String(env.API_KEYS).split(",").map(x => x.trim()).filter(Boolean) : null,
    soundcloudClientId: env.SOUNDCLOUD_CLIENT_ID || null,
  };
}

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
  UPSTREAM: [502, "UPSTREAM_ERROR", "خطا در SoundCloud", "SoundCloud error"],
  TIMEOUT: [504, "UPSTREAM_TIMEOUT", "مهلت تمام شد", "Timeout"],
  TOO_LARGE: [413, "PAYLOAD_TOO_LARGE", "حجم بیش از حد مجاز", "Too large"],
  NOT_DOWNLOADABLE: [403, "NOT_DOWNLOADABLE", "دانلود برای این ترک مجاز نیست", "No download"],
  INTERNAL: [500, "INTERNAL_ERROR", "خطای داخلی", "Internal error"],
};
const err = (c, extra = {}, reqId) => {
  const [status, code, fa, en] = ERR[c] || ERR.INTERNAL;
  return json({ ok: false, error: { code, message: { fa, en }, ...extra } }, { status }, reqId);
};

/* ------------------------------- SoundCloud ----------------------------- */
const SC = "https://soundcloud.com/";
const SC_API = "https://api-v2.soundcloud.com/";
const SC_AUTH = "https://api-auth.soundcloud.com/";
let SC_CID_CACHE = null;
let SC_CID_CACHE_UNTIL = 0;
let SC_CID_PENDING = null;

class SoundCloud {
  constructor(clientIdOrKv = null, kv = null) {
    // Backward compatible: new SoundCloud(kv) and new SoundCloud(clientId, kv).
    if (clientIdOrKv && typeof clientIdOrKv.get === "function" && kv == null) {
      this.clientId = null; this.kv = clientIdOrKv;
    } else {
      this.clientId = clientIdOrKv || null; this.kv = kv;
    }
  }

  async init() {
    if (this.clientId) return this.clientId;
    if (SC_CID_CACHE && Date.now() < SC_CID_CACHE_UNTIL) {
      this.clientId = SC_CID_CACHE;
      return this.clientId;
    }
    if (this.kv) { try { const c = await this.kv.get("sc:cid"); if (c) {
      this.clientId = c; SC_CID_CACHE = c; SC_CID_CACHE_UNTIL = Date.now() + 45 * 60 * 1000; return c;
    } } catch {} }
    return this.setClientId();
  }

  async setClientId() {
    if (SC_CID_PENDING) {
      this.clientId = await SC_CID_PENDING;
      return this.clientId;
    }
    SC_CID_PENDING = (async () => {
      const page = await (await fetch(SC, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } })).text();
      const assets = [...page.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^.\"]+\.js)"/g)];
      if (!assets.length) throw new Error("no assets");
      for (let i = assets.length - 1; i >= Math.max(0, assets.length - 3); i--) {
        try {
          const ac = await (await fetch(assets[i][1])).text();
          const ids = [...ac.matchAll(/[,{]client_id:"([^\"]+)"/g)];
          if (ids.length) {
            const cid = ids[Math.floor(Math.random() * ids.length)][1];
            SC_CID_CACHE = cid; SC_CID_CACHE_UNTIL = Date.now() + 45 * 60 * 1000;
            if (this.kv) try { await this.kv.put("sc:cid", cid, { expirationTtl: 3600 }); } catch {}
            return cid;
          }
        } catch {}
      }
      throw new Error("Could not find client ID");
    })();
    try { this.clientId = await SC_CID_PENDING; return this.clientId; }
    finally { SC_CID_PENDING = null; }
  }
  async getClientId() {
    if (!this.clientId) await this.setClientId();
    return this.clientId;
  }

  async checkClientId() {
    try {
      const r = await fetch(`${SC_AUTH}oauth/session?client_id=${await this.getClientId()}`);
      return !!(await r.json()).session;
    } catch { return false; }
  }

  // Authed request with auto client_id refresh on 401/403 — keeps the service
  // alive even when SoundCloud rotates the id. Retries a couple of times.
  async _get(url, tries = 2) {
    let last;
    for (let i = 0; i <= tries; i++) {
      const cid = await this.getClientId();
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${sep}client_id=${cid}`,
        { headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.status === 401 || res.status === 403) {
        // client_id rotated -> force rescrape and retry
        this.clientId = null;
        SC_CID_CACHE = null; SC_CID_CACHE_UNTIL = 0;
        if (this.kv) try { await this.kv.delete("sc:cid"); } catch {}
        last = res; continue;
      }
      if (!res.ok) { last = res; break; }
      return res.json();
    }
    const e = new Error("SoundCloud request failed" + (last ? " (" + last.status + ")" : ""));
    e.status = last ? last.status : 0;
    throw e;
  }

  _norm(m, detailed = false) {
    const art = (m.artwork_url || m.user?.avatar_url || "").replace("large", "t500x500");
    const t = {
      id: "sc_" + m.id, sid: m.id, source: "soundcloud", title: m.title,
      artist: m.user?.username || null, duration_ms: m.duration || null,
      cover: art || null, page_url: m.permalink_url,
      genre: m.genre || null, license: m.license || null,
      streamable: !!m.streamable,
      hasProgressive: (m.media?.transcodings || []).some(x => x.format?.protocol === "progressive"),
      hasHls: (m.media?.transcodings || []).some(x => /hls/i.test(x.format?.protocol || "")),
      downloadable: !!m.streamable || !!(m.downloadable && m.download_url),
      plays: m.playback_count || null, likes: m.likes_count || null,
      reposts: m.reposts_count || null, comments: m.comment_count || null,
      created_at: m.created_at || null,
    };
    if (detailed) {
      t.description = m.description || null;
      t.tag_list = m.tag_list || null;
      t.waveform_url = m.waveform_url || null;
      t.bpm = m.bpm || null;
      t.label = m.label_name || null;
      t.transcodings = (m.media?.transcodings || []).map(x => ({
        protocol: x.format?.protocol, mime: x.format?.mime_type })).slice(0, 6);
    }
    return t;
  }

  async searchMusic(query, { limit = 20, offset = 0 } = {}) {
    const p = new URLSearchParams({
      q: query, sc_a_id: "801c8a51-9227-40d9-9c11-ac16f6bca216", variant_ids: "",
      facet: "genre", user_id: "367935-565481-285242-514567", limit: String(limit),
      offset: String(offset), linked_partitioning: "1", app_version: "1667398191", app_locale: "en"
    });
    const d = await this._get(`${SC_API}search/tracks?${p}`);
    return (d.collection || []).filter(m => m.kind === "track" && m.streamable).map(m => this._norm(m));
  }

  async getMusic(id) {
    const m = await this._get(`${SC_API}tracks/${id}`);
    return m && m.id ? this._norm(m, true) : null;
  }

  // Resolve the best playable media URL (prefers progressive mp3).
  async streamUrl(id, { allowHls = true } = {}) {
    const m = await this._get(`${SC_API}tracks/${id}`);
    return this._resolveMedia(m, allowHls);
  }
  async _resolveMedia(m, allowHls = true) {
    if (!m || !m.media?.transcodings) return null;
    const cid = await this.getClientId();
    // 1) true downloadable file
    if (m.downloadable && m.download_url) {
      try {
        const d = await (await fetch(`${m.download_url}?client_id=${cid}`,
          { headers: { "User-Agent": "Mozilla/5.0" } })).json();
        if (d.url) return { url: d.url, file: true };
        if (d.redirectUri) return { url: d.redirectUri, file: true };
      } catch {}
    }
    // 2) progressive (real audio file) preferred over HLS
    const tr = m.media.transcodings.find(t => t.format?.protocol === "progressive");
    if (tr) {
      try {
        const d = await (await fetch(`${tr.url}?client_id=${cid}&track_authorization=${m.track_authorization || ""}`)).json();
        if (d.url) return { url: d.url, file: true };
      } catch {}
    }
    // 3) HLS is valid for preview, but is not a downloadable audio file.
    if (!allowHls) return null;
    const any = m.media.transcodings.find(t => /hls/i.test(t.format?.protocol || "")) || m.media.transcodings[0];
    if (any) {
      try {
        const d = await (await fetch(`${any.url}?client_id=${cid}&track_authorization=${m.track_authorization || ""}`)).json();
        if (d.url) return { url: d.url, file: false, hls: true };
      } catch {}
    }
    return null;
  }

  async musicByUrl(u) {
    if (!/^https?:\/\/(www\.|m\.)?soundcloud\.com\/[\w-]+\/[\w-]+\/?/.test(u)) return null;
    const html = await (await fetch(u)).text();
    const m = [...html.matchAll(/soundcloud:\/\/sounds:(\d+)/g)];
    return m.length ? await this.getMusic(m[0][1]) : null;
  }
}

/* ------------------------------ SSRF proxy ------------------------------ */
const AUDIO = /^(audio\/|application\/(vnd\.apple\.mpegurl|x-mpegURL|mpegURL|octet-stream))/i, IMAGE = /^image\//i;
class PErr extends Error { constructor(m, s) { super(m); this.status = s; } }
const SC_HOSTS = ["sndcdn.com", "soundcloud.com", "media-streaming.soundcloud.cloud",
  "playback.media-streaming.soundcloud.cloud", "a-v2.sndcdn.com"];
function hostOk(host) {
  host = (host || "").toLowerCase();
  return SC_HOSTS.some(d => host === d || host.endsWith("." + d));
}
function isPrivate(host) {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "::1" || h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = h.match(/^(\d+)\.(\d+)\./);
  if (m) { const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true; }
  return false;
}
function validMedia(raw) {
  let u; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || (u.port || "443") !== "443" || isPrivate(u.hostname) || !hostOk(u.hostname)) return null;
  return u;
}
async function fetchMedia(url, request, cfg, hops = 3) {
  let cur = url;
  const range = request.headers.get("Range");
  for (let i = 0; i <= hops; i++) {
    const v = validMedia(cur); if (!v) throw new PErr("blocked", 403);
    const headers = { "User-Agent": "Mozilla/5.0" }; if (range) headers.Range = range;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort("t"), cfg.upstreamTimeoutMs);
    let res;
    try { res = await fetch(v.toString(), { redirect: "manual", headers, signal: ac.signal }); }
    finally { clearTimeout(t); }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location"); if (!loc) throw new PErr("redir", 502);
      cur = new URL(loc, v).toString(); continue;
    }
    return res;
  }
  throw new PErr("redirs", 502);
}
function cap(stream, max) {
  if (!stream) return stream;
  const rd = stream.getReader(); let sent = 0;
  return new ReadableStream({ async pull(c) {
    const { done, value } = await rd.read();
    if (done) return c.close();
    sent += value.byteLength;
    if (sent > max) { c.error(new PErr("big", 413)); rd.cancel(); return; }
    c.enqueue(value);
  }, cancel() { rd.cancel(); } });
}

function resolvePlaylistUri(uri, manifestUrl) {
  try { return new URL(uri, manifestUrl).toString(); } catch { return null; }
}

async function fetchHlsParts(manifestUrl, request, cfg) {
  const maxBytes = cfg.maxDownloadMB * 1048576;
  const maxSegments = Math.max(1, parseInt(cfg.maxHlsSegments || 1500, 10));
  const manifestRes = await fetchMedia(manifestUrl, request, cfg);
  if (!manifestRes.ok) throw new PErr("hls-manifest", manifestRes.status);
  const manifestText = await manifestRes.text();
  if (!manifestText.startsWith("#EXTM3U")) throw new PErr("not-hls", 400);
  if (manifestText.length > 1024 * 1024) throw new PErr("hls-large", 413);
  const lines = manifestText.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const mapLine = lines.find(l => l.startsWith("#EXT-X-MAP:"));
  const initUri = mapLine && mapLine.match(/URI="([^"]+)"/)?.[1];
  const initUrl = initUri ? resolvePlaylistUri(initUri, manifestUrl) : null;
  if (!initUrl || !validMedia(initUrl)) throw new PErr("hls-map", 400);
  const parts = [initUrl];
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const u = resolvePlaylistUri(line, manifestUrl);
    if (!u || !validMedia(u)) throw new PErr("hls-segment", 400);
    parts.push(u);
  }
  if (parts.length > maxSegments) throw new PErr("hls-many", 413);

  let partIndex = 0, reader = null, sent = 0;
  const stream = new ReadableStream({
    async pull(c) {
      try {
        while (true) {
          if (!reader) {
            if (partIndex >= parts.length) return c.close();
            const res = await fetchMedia(parts[partIndex++], request, cfg);
            if (!res.ok) throw new PErr("hls-part", res.status);
            reader = res.body.getReader();
          }
          const { done, value } = await reader.read();
          if (done) { reader = null; continue; }
          sent += value.byteLength;
          if (sent > maxBytes) { c.error(new PErr("big", 413)); try { reader.cancel(); } catch {} return; }
          return c.enqueue(value);
        }
      } catch (e) { c.error(e); }
    },
    cancel() { try { reader?.cancel(); } catch {} }
  });
  return { stream, bytes: null };
}

async function proxyHlsAsAudio(manifestUrl, request, cfg, filenameBase) {
  try {
    const { stream } = await fetchHlsParts(manifestUrl, request, cfg);
    const h = new Headers();
    h.set("Content-Type", "audio/mp4");
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Cache-Control", "public, max-age=3600");
    if (filenameBase) h.set("Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filenameBase.replace(/[^\w؀-ۿ -]/g, "_"))}.m4a`);
    return new Response(stream, { status: 200, headers: h });
  } catch (e) {
    if (e instanceof PErr) return err(e.status === 413 ? "TOO_LARGE" : "NOT_DOWNLOADABLE", { detail: e.message });
    return err("UPSTREAM", { detail: String(e?.message || e) });
  }
}
async function proxyMedia(target, request, cfg, kind, { strictAudio = false } = {}) {
  let res;
  try { res = await fetchMedia(target, request, cfg); }
  catch (e) { return err("UPSTREAM", { detail: e.message }); }
  if (!res.ok && res.status !== 206) return err("UPSTREAM", { upstream_status: res.status });
  const ct = res.headers.get("Content-Type") || "";
  if (strictAudio && (!/^audio\\//i.test(ct) || /mpegurl|mpeg-url/i.test(ct)))
    return err("NOT_DOWNLOADABLE", { detail: "SoundCloud returned a stream manifest, not an audio file" });
  if (!(kind === "image" ? IMAGE.test(ct) : AUDIO.test(ct))) return err("UPSTREAM", { detail: "content-type" });
  const max = cfg.maxDownloadMB * 1048576;
  const cl = parseInt(res.headers.get("Content-Length") || "0", 10);
  if (cl > max) return err("TOO_LARGE", { max_mb: cfg.maxDownloadMB });
  const h = new Headers();
  h.set("Content-Type", ct); h.set("X-Content-Type-Options", "nosniff");
  h.set("Cache-Control", "public, max-age=3600");
  if (res.headers.get("Accept-Ranges")) h.set("Accept-Ranges", res.headers.get("Accept-Ranges"));
  if (res.headers.get("Content-Range")) h.set("Content-Range", res.headers.get("Content-Range"));
  if (cl) h.set("Content-Length", String(cl));
  return new Response(cap(res.body, max), { status: res.status === 206 ? 206 : 200, headers: h });
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
  fa: { dir: "rtl", lang: "fa", title: "ساندکلاد | جستجو و دانلود موسیقی",
    tagline: "جستجو، پیش‌نمایش و دانلود آهنگ‌ها از SoundCloud",
    ph: "نام آهنگ یا هنرمند… مثلاً امیر تتلو", btn: "جستجو",
    prev: "پیش‌نمایش", dl: "دانلود", open: "باز کردن در SoundCloud", details: "جزئیات",
    loading: "در حال جستجو…", none: "چیزی پیدا نشد؛ عبارت دیگری امتحان کنید",
    net: "خطا در ارتباط؛ دوباره تلاش کنید", hls: "این ترک فقط پخش آنلاین SoundCloud دارد و فایل مستقیم قابل دانلود نیست.",
    desc: "توضیحات", plays: "پخش", likes: "لایک", genre: "سبک", lic: "مجوز",
    opts: "دانلود", close: "بستن", artist: "هنرمند", recent: "جستجوهای اخیر",
    howT: "چطور کار می‌کند؟",
    howB: "این سرویس مستقیماً به SoundCloud متصل می‌شود؛ نام آهنگ یا هنرمند را جستجو کنید، پیش‌نمایش بشنوید و در صورت مجازبودن دانلود کنید.",
    apiT: "مستندات API", faqT: "سؤالات متداول", termsT: "قوانین",
    termsB: "این سرویس فقط به SoundCloud متصل می‌شود و هیچ فایلی را میزبانی نمی‌کند. حق نشر هر اثر متعلق به صاحب آن است.",
    foot: "ساخته‌شده توسط علی موسوی (AliMsvD)", lang: "English",
    errT: "کدهای خطا", code: "کد", mean: "معنی",
    faq: [["چرا بعضی آهنگ‌ها دانلود ندارند؟","SoundCloud اجازهٔ دانلود نداده؛ فقط پیش‌نمایش ممکن است."],
          ["آیا فایل‌ها ذخیره می‌شوند؟","خیر؛ همه مستقیم از CDN ساندکلاد پخش می‌شوند."],
          ["چرا بعضی آهنگ‌ها پخش نمی‌شوند؟","برخی ترک‌ها فقط استریم HLS دارند که در پلیر ساده پشتیبانی نمی‌شود."]] },
  en: { dir: "ltr", lang: "en", title: "SoundCloud | Music Search & Download",
    tagline: "Search, preview and download tracks from SoundCloud",
    ph: "Track or artist… e.g. tataloo", btn: "Search",
    prev: "Preview", dl: "Download", open: "Open on SoundCloud", details: "Details",
    loading: "Searching…", none: "Nothing found; try another query",
    net: "Connection error; please retry", hls: "This track is only available as a SoundCloud stream; no direct audio file is available.",
    desc: "Description", plays: "Plays", likes: "Likes", genre: "Genre", lic: "License",
    opts: "Download", close: "Close", artist: "Artist", recent: "Recent searches",
    howT: "How it works",
    howB: "Connects directly to SoundCloud; search a track or artist, preview it and download where allowed.",
    apiT: "API Docs", faqT: "FAQ", termsT: "Terms",
    termsB: "Only connects to SoundCloud; hosts no files. Copyright belongs to owners.",
    foot: "Built by Ali Mousavi (AliMsvD)", lang: "فارسی",
    errT: "Error codes", code: "Code", mean: "Meaning",
    faq: [["Why no download on some?","SoundCloud didn't allow download; preview only."],
          ["Are files stored?","No; everything streams from SoundCloud CDN."],
          ["Why won't some play?","Some tracks only have HLS streams not supported by a simple player."]] },
};
const ERRROWS = [["BAD_REQUEST","پارامتر نامعتبر","Invalid parameter"],["NOT_FOUND","پیدا نشد","Not found"],
  ["UNAUTHORIZED","احراز هویت لازم","Auth required"],["RATE_LIMITED","بیش از حد","Rate limit"],
  ["UPSTREAM_ERROR","خطای SoundCloud","SoundCloud error"],["UPSTREAM_TIMEOUT","مهلت","Timeout"],
  ["PAYLOAD_TOO_LARGE","حجم زیاد","Too large"],["NOT_DOWNLOADABLE","دانلود مجاز نیست","No download"],
  ["INTERNAL_ERROR","خطای داخلی","Internal"]];

/* --------------------------------- UI ----------------------------------- */
function serverCard(t, base, lang) {
  const s = STR[lang] || STR.fa;
  const dur = fmtDur(t.duration_ms, lang === "fa");
  const sid = t.id.replace(/^sc_/, "");
  const fa_d = n => String(n).replace(/[0-9]/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
  let b = `<div class="card"><div class="im" data-d="${t.id}">`;
  if (t.cover) b += `<img loading="lazy" src="${base}/api/v1/cover?url=${encodeURIComponent(t.cover)}" alt="">`;
  if (t.streamable) b += `<button class="pbtn" data-p="${t.id}" aria-label="${esc(s.prev)}">▶</button>`;
  b += `</div><div class="b"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div><div class="badges">`;
  if (dur) b += `<span class="badge">${dur}</span>`;
  if (t.genre) b += `<span class="badge">${esc(t.genre)}</span>`;
  if (t.plays) b += `<span class="badge">▶${lang === "fa" ? fa_d(t.plays) : t.plays}</span>`;
  if (t.downloadable) b += `<span class="badge hot">${esc(s.dl)}</span>`;
  b += `</div></div><div class="actions">`;
  if (t.streamable) b += `<button class="btn mini ghost" data-p="${t.id}">${esc(s.prev)}</button>`;
  b += `<button class="btn mini ghost" data-d="${t.id}">${esc(s.details)}</button>`;
  if (t.downloadable) b += `<a class="btn mini" href="${base}/api/v1/download?id=${encodeURIComponent(sid)}">${esc(s.dl)}</a>`;;
  return b + `</div></div>`;
}

function renderPage(lang, nonce, opts = {}) {
  const s = STR[lang] || STR.fa;
  const { q = "", results = null, origin = "" } = opts;
  const errRows = ERRROWS.map(([c, fa, en]) =>
    `<tr><td><code>${c}</code></td><td>${esc(lang === "fa" ? fa : en)}</td></tr>`).join("");
  const faq = s.faq.map(([q2, a]) =>
    `<details class="reveal"><summary>${esc(q2)}</summary><p>${esc(a)}</p></details>`).join("");
  // Server-rendered result list (works with JS disabled).
  let resultsHtml = "";
  if (results !== null) {
    resultsHtml = results.length
      ? `<div class="grid">${results.map(t => serverCard(t, origin, lang)).join("")}</div>`
      : `<p style="text-align:center;color:var(--mut);padding:2rem">${esc(s.none)}</p>`;
  }
  return `<!DOCTYPE html>
<html lang="${s.lang}" dir="${s.dir}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(s.title)}</title><meta name="description" content="${esc(s.tagline)}">
<meta name="theme-color" content="#ff5500">
<script nonce="${nonce}">
try{if("IntersectionObserver"in window&&!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("js")}catch(e){}
setTimeout(function(){document.querySelectorAll(".reveal").forEach(function(n){n.style.opacity=1;n.style.transform="none"})},900);
</script>
<style nonce="${nonce}">
:root{--bg:#f6f6f8;--fg:#14141a;--card:#fff;--mut:#6b7280;--acc:#ff5500;--acc2:#ff8a3d;--bd:#e8e8ee;--sh:0 6px 24px rgba(0,0,0,.07);--r:1.1rem}
@media(prefers-color-scheme:dark){:root{--bg:#0d0d12;--fg:#ececf2;--card:#17171f;--mut:#9aa0ae;--acc:#ff6a2b;--acc2:#ff9d5c;--bd:#262632;--sh:0 6px 24px rgba(0,0,0,.5)}}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Tahoma,"Noto Naskh Arabic",sans-serif;line-height:1.75}
.wrap{max-width:960px;margin:0 auto;padding:0 1rem}
header{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;padding:.7rem 1rem}
.brand{font-weight:900;font-size:1.2rem;display:flex;align-items:center;gap:.5rem}
.brand .dot{width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,var(--acc),var(--acc2));display:inline-block}
.hbtns{display:flex;gap:.5rem;align-items:center}
.burger,.langb{cursor:pointer;background:var(--card);border:1px solid var(--bd);border-radius:.7rem;padding:.45rem .8rem;color:var(--fg);font-size:1rem;text-decoration:none;font-weight:600}
nav{display:none;gap:.4rem;padding:.4rem 1rem;flex-wrap:wrap}nav.open{display:flex}
nav a{color:var(--fg);text-decoration:none;padding:.35rem .7rem;border-radius:.6rem;background:var(--card);border:1px solid var(--bd);font-size:.9rem}
.hero{text-align:center;padding:3.2rem 1rem 1.6rem}
.hero h1{font-size:2.2rem;margin:0 0 .4rem;font-weight:900;letter-spacing:-.5px}
.hero .grad{background:linear-gradient(90deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{color:var(--mut);margin:.2rem 0 1.4rem}
.search{display:flex;gap:.6rem;max-width:620px;margin:0 auto}
.search input{flex:1;min-width:0;padding:.95rem 1.2rem;border:1px solid var(--bd);border-radius:1rem;background:var(--card);color:var(--fg);font-size:1.05rem;box-shadow:var(--sh)}
.search input:focus{outline:2px solid var(--acc);border-color:transparent}
.btn{background:linear-gradient(90deg,var(--acc),var(--acc2));color:#fff;border:none;border-radius:1rem;padding:.95rem 1.4rem;font-size:1rem;cursor:pointer;font-weight:700;white-space:nowrap}
.btn:active{transform:scale(.97)}
.btn.ghost{background:transparent;color:var(--acc);border:1px solid var(--acc);font-weight:600}
.btn.mini{padding:.45rem .85rem;font-size:.82rem;border-radius:.7rem}
.chips{display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;margin-top:1rem}
.chip{font-size:.8rem;background:var(--card);border:1px solid var(--bd);border-radius:2rem;padding:.3rem .9rem;cursor:pointer;color:var(--mut)}
.grid{display:flex;flex-direction:column;gap:.7rem;margin-top:1.4rem}
.card{background:var(--card);border:1px solid var(--bd);border-radius:var(--r);display:flex;align-items:center;gap:.9rem;padding:.6rem;box-shadow:var(--sh);transition:transform .2s,border-color .2s}
.card:hover{transform:translateY(-2px);border-color:var(--acc)}
.card .im{position:relative;width:74px;height:74px;border-radius:.8rem;overflow:hidden;background:linear-gradient(135deg,var(--bd),var(--bg));flex-shrink:0;cursor:pointer}
.card .im img{width:100%;height:100%;object-fit:cover;display:block}
.card .im .pbtn{position:absolute;inset:0;background:rgba(0,0,0,.35);border:none;color:#fff;font-size:1.2rem;cursor:pointer;opacity:0;transition:opacity .2s;display:flex;align-items:center;justify-content:center}
.card .im:hover .pbtn{opacity:1}
.card .b{flex:1;min-width:0;display:flex;flex-direction:column;gap:.2rem}
.card .t{font-weight:700;font-size:.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .a{color:var(--mut);font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badges{display:flex;gap:.3rem;flex-wrap:wrap}
.badge{font-size:.64rem;background:var(--bg);border:1px solid var(--bd);border-radius:1rem;padding:.1rem .55rem;color:var(--mut);text-transform:capitalize}
.badge.hot{background:linear-gradient(90deg,var(--acc),var(--acc2));color:#fff;border:none}
.actions{display:flex;gap:.4rem;flex-shrink:0}
.actions .btn,.actions a{text-decoration:none;white-space:nowrap}
section{padding:2.4rem 0}section h2{font-size:1.45rem;margin-bottom:.9rem;font-weight:900}
details{background:var(--card);border:1px solid var(--bd);border-radius:.9rem;padding:.85rem 1rem;margin-bottom:.6rem}
summary{cursor:pointer;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th,td{border:1px solid var(--bd);padding:.5rem .7rem;text-align:start}
pre{overflow:auto;background:var(--card);border:1px solid var(--bd);border-radius:.9rem;padding:1rem;direction:ltr;text-align:left;font-size:.8rem}
footer{border-top:1px solid var(--bd);text-align:center;padding:2rem 1rem;color:var(--mut);font-size:.85rem}
footer a{color:var(--acc);text-decoration:none;font-weight:600}
audio{width:100%}
[hidden]{display:none!important}
/* skeleton */
.sk{background:var(--card);border-radius:var(--r);height:88px;border:1px solid var(--bd);animation:pl 1.2s infinite}
@keyframes pl{50%{opacity:.5}}
/* modal */
.modal{position:fixed;inset:0;background:rgba(8,8,14,.62);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:1rem;z-index:60;opacity:0;pointer-events:none;transition:opacity .25s}
.modal.open{opacity:1;pointer-events:auto}
.modal .box{background:var(--card);border:1px solid var(--bd);border-radius:1.3rem;max-width:680px;width:100%;max-height:90vh;overflow:auto;transform:translateY(16px) scale(.98);transition:transform .25s}
.modal.open .box{transform:none}
.modal .hd{display:flex;gap:1.1rem;padding:1.3rem;position:relative}
.modal .hd img{width:150px;height:150px;border-radius:1.1rem;object-fit:cover;flex-shrink:0;box-shadow:var(--sh)}
.modal .hd .ti{flex:1;min-width:0}
.modal .hd h3{margin:.1rem 0 .35rem;font-size:1.2rem;line-height:1.3}
.modal .hd .ar{color:var(--mut);font-size:.95rem}
.x{position:absolute;top:.9rem;inset-inline-end:.9rem;width:34px;height:34px;border-radius:50%;background:var(--bg);border:1px solid var(--bd);cursor:pointer;color:var(--fg);font-size:1rem;line-height:1}
.modal .bd{padding:0 1.3rem 1.3rem}
.modal .desc{font-size:.88rem;color:var(--mut);white-space:pre-wrap;max-height:200px;overflow:auto;background:var(--bg);border-radius:.8rem;padding:.9rem;margin:.9rem 0}
.dlrow{display:flex;justify-content:space-between;align-items:center;border:1px solid var(--bd);border-radius:.8rem;padding:.6rem .9rem;margin:.5rem 0}
.dlrow .l{font-size:.85rem;font-weight:600}
.stat{display:flex;gap:1.2rem;flex-wrap:wrap;margin:.5rem 0;color:var(--mut);font-size:.85rem}
html.js .reveal{opacity:0;transform:translateY(16px);transition:opacity .55s ease,transform .55s ease}
html.js .reveal.in{opacity:1;transform:none}
#dbg{position:fixed;inset-inline:0;bottom:0;max-height:40vh;overflow:auto;background:#3a0d0d;color:#ffd9d9;font-size:.75rem;padding:.5rem;display:none;z-index:99;direction:ltr}
@media(max-width:600px){.search{flex-direction:column}.hero h1{font-size:1.6rem}.modal .hd{flex-direction:column;align-items:center;text-align:center}.modal .hd img{width:200px;height:200px}.card .im{width:60px;height:60px}.actions{flex-direction:column}}
details{background:var(--card);border:1px solid var(--bd);border-radius:.9rem;padding:.85rem 1rem;margin-bottom:.6rem}
summary{cursor:pointer;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th,td{border:1px solid var(--bd);padding:.5rem .7rem;text-align:start}
pre{overflow:auto;background:var(--card);border:1px solid var(--bd);border-radius:.9rem;padding:1rem;direction:ltr;text-align:left;font-size:.8rem}
footer{border-top:1px solid var(--bd);text-align:center;padding:2rem 1rem;color:var(--mut);font-size:.85rem}
footer a{color:var(--acc);text-decoration:none;font-weight:600}
audio{width:100%}
[hidden]{display:none!important}
/* skeleton */
.sk{background:var(--card);border-radius:var(--r);aspect-ratio:1;border:1px solid var(--bd);animation:pl 1.2s infinite}
@keyframes pl{50%{opacity:.5}}
/* modal */
.modal{position:fixed;inset:0;background:rgba(8,8,14,.62);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:1rem;z-index:60;opacity:0;pointer-events:none;transition:opacity .25s}
.modal.open{opacity:1;pointer-events:auto}
.modal .box{background:var(--card);border:1px solid var(--bd);border-radius:1.3rem;max-width:660px;width:100%;max-height:90vh;overflow:auto;transform:translateY(16px) scale(.98);transition:transform .25s}
.modal.open .box{transform:none}
.modal .hd{display:flex;gap:1.1rem;padding:1.3rem;position:relative}
.modal .hd img{width:150px;height:150px;border-radius:1.1rem;object-fit:cover;flex-shrink:0;box-shadow:var(--sh)}
.modal .hd .ti{flex:1;min-width:0}
.modal .hd h3{margin:.1rem 0 .35rem;font-size:1.2rem;line-height:1.3}
.modal .hd .ar{color:var(--mut);font-size:.95rem}
.x{position:absolute;top:.9rem;inset-inline-end:.9rem;width:34px;height:34px;border-radius:50%;background:var(--bg);border:1px solid var(--bd);cursor:pointer;color:var(--fg);font-size:1rem;line-height:1}
.modal .bd{padding:0 1.3rem 1.3rem}
.modal .desc{font-size:.88rem;color:var(--mut);white-space:pre-wrap;max-height:170px;overflow:auto;background:var(--bg);border-radius:.8rem;padding:.9rem;margin:.9rem 0}
.dlrow{display:flex;justify-content:space-between;align-items:center;border:1px solid var(--bd);border-radius:.8rem;padding:.6rem .9rem;margin:.5rem 0}
.dlrow .l{font-size:.85rem;font-weight:600}
.stat{display:flex;gap:1.2rem;flex-wrap:wrap;margin:.5rem 0;color:var(--mut);font-size:.85rem}
html.js .reveal{opacity:0;transform:translateY(16px);transition:opacity .55s ease,transform .55s ease}
html.js .reveal.in{opacity:1;transform:none}
#dbg{position:fixed;inset-inline:0;bottom:0;max-height:40vh;overflow:auto;background:#3a0d0d;color:#ffd9d9;font-size:.75rem;padding:.5rem;display:none;z-index:99;direction:ltr}
@media(max-width:600px){.search{flex-direction:column}.hero h1{font-size:1.6rem}.modal .hd{flex-direction:column;align-items:center;text-align:center}.modal .hd img{width:200px;height:200px}}
</style>
</head>
<body>
<div id="dbg" aria-hidden="true"></div>
<header>
  <div class="brand"><span class="dot"></span>${esc(s.title)}</div>
  <div class="hbtns">
    <a class="langb" href="?lang=${lang === "fa" ? "en" : "fa"}">${esc(s.lang)}</a>
    <button class="burger" id="burger" aria-label="menu" aria-expanded="false">☰</button>
  </div>
</header>
<nav id="nav">
  <a href="#how">${esc(s.howT)}</a><a href="#api">${esc(s.apiT)}</a>
  <a href="#faq">${esc(s.faqT)}</a><a href="#terms">${esc(s.termsT)}</a>
</nav>
<div class="wrap">
  <div class="hero reveal">
    <h1><span class="grad">SoundCloud</span> ${esc(s.title.split("|")[0].trim() === "ساندکلاد" ? "" : "")}</h1>
    <p>${esc(s.tagline)}</p>
    <form class="search" id="sform" action="/" method="get">
      <input type="search" name="q" placeholder="${esc(s.ph)}" required autocomplete="off" id="q" dir="auto" value="${esc(q)}">
      <button class="btn" type="submit">${esc(s.btn)}</button>
    </form>
    <div class="chips" id="chips"></div>
  </div>
  <div id="results" aria-live="polite">${resultsHtml}</div>
  <section id="how" class="reveal"><h2>${esc(s.howT)}</h2><p>${esc(s.howB)}</p></section>
  <section id="api" class="reveal"><h2>${esc(s.apiT)}</h2>
    <pre>GET /api/v1/search?q=QUERY&amp;page=1
GET /api/v1/track?id=1554652312
GET /api/v1/stream?id=1554652312   (proxy, Range)
GET /api/v1/download?id=1554652312
GET /api/v1/cover?url=...
GET /health  ·  GET /openapi.json</pre>
    <pre># legacy (original) endpoints
/search?q= · /music?id= · /download-url?id=
/direct-download?id= · /music-by-url?url=</pre>
    <pre>// reuse in your own code / bot
import { SoundCloud } from "./worker.js";
const sc = new SoundCloud(); await sc.init();
const tracks = await sc.searchMusic("تتلو");
const media  = await sc.streamUrl(tracks[0].sid);</pre>
    <h3>${esc(s.errT)}</h3>
    <table><thead><tr><th>${esc(s.code)}</th><th>${esc(s.mean)}</th></tr></thead><tbody>${errRows}</tbody></table>
  </section>
  <section id="faq" class="reveal"><h2>${esc(s.faqT)}</h2>${faq}</section>
  <section id="terms" class="reveal"><h2>${esc(s.termsT)}</h2><p>${esc(s.termsB)}</p></section>
</div>
<footer>${esc(s.foot)} · <a href="https://t.me/AliMsvD" rel="noopener">t.me/AliMsvD</a></footer>
<script type="application/json" id="seed" nonce="${nonce}">${JSON.stringify(results || []).replace(/</g, "\\u003c")}</script>
<div class="modal" id="modal" role="dialog" aria-modal="true"><div class="box">
<button class="x" id="mx" aria-label="${esc(s.close)}">✕</button>
<div class="hd"><img id="mimg" alt=""><div class="ti"><h3 id="mtitle"></h3><div class="ar" id="martist"></div><div class="stat" id="mstat"></div><div class="badges" id="mbadges"></div></div></div>
<div class="bd"><div id="mplayer"></div><div id="mdesc"></div><div id="mdl"></div></div>
</div></div>
<script nonce="${nonce}">
(function(){"use strict";
var L=${JSON.stringify(lang)},T={loading:${JSON.stringify(s.loading)},none:${JSON.stringify(s.none)},
net:${JSON.stringify(s.net)},prev:${JSON.stringify(s.prev)},dl:${JSON.stringify(s.dl)},open:${JSON.stringify(s.open)},
details:${JSON.stringify(s.details)},desc:${JSON.stringify(s.desc)},opts:${JSON.stringify(s.opts)},
plays:${JSON.stringify(s.plays)},likes:${JSON.stringify(s.likes)},recent:${JSON.stringify(s.recent)},hls:${JSON.stringify(s.hls)} };
var DATA={};
// Seed DATA with server-rendered results so modal works pre-search.
try{var seed=JSON.parse(document.getElementById('seed').textContent||'[]');
seed.forEach(function(t){t.sid=t.sid||t.id.replace(/^sc_/,'');t.duration=t.duration_ms?fmtms(t.duration_ms):'';DATA[t.id]=t});}catch(e){}
function fmtms(ms){var s=Math.round(ms/1000),m=Math.floor(s/60),r=s%60;var o=m+':'+String(r).padStart(2,'0');return L==='fa'?o.replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[d]}):o}
function show(m){try{var d=document.getElementById('dbg');if(location.search.indexOf('debug=1')>-1){d.style.display='block';d.textContent+=m+'\\n'}}catch(e){}}
window.addEventListener('error',function(e){show('ERR: '+e.message+' @'+e.lineno)});
try{var b=document.getElementById('burger'),n=document.getElementById('nav');
if(b)b.addEventListener('click',function(){n.classList.toggle('open');b.setAttribute('aria-expanded',n.classList.contains('open'))})}catch(e){show(e.message)}
try{if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target)}})},{threshold:.08});
document.querySelectorAll('.reveal').forEach(function(n){io.observe(n)})}else{document.querySelectorAll('.reveal').forEach(function(n){n.classList.add('in')})}}catch(e){show(e.message)}
function es(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
function fd(n){if(L!=='fa')return String(n);return String(n).replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[d]})}
/* recent chips */
var REC=[];
try{REC=JSON.parse(localStorage.getItem('sc_rec')||'[]')}catch(e){}
function renderChips(){var c=document.getElementById('chips');if(!REC.length){c.innerHTML='';return}
c.innerHTML='<span class="chip" style="border:none;background:none">'+T.recent+':</span>'+REC.map(function(r){return '<button class="chip" data-q="'+es(r)+'">'+es(r)+'</button>'}).join('')}
renderChips();
document.getElementById('chips').addEventListener('click',function(e){var b=e.target.closest('[data-q]');if(b){document.getElementById('q').value=b.getAttribute('data-q');document.getElementById('sform').requestSubmit()}});
function addRecent(q){REC=[q].concat(REC.filter(function(x){return x!==q})).slice(0,6);try{localStorage.setItem('sc_rec',JSON.stringify(REC))}catch(e){}renderChips()}
var modal=document.getElementById('modal');
function closeM(){modal.classList.remove('open');var a=document.querySelector('#mplayer audio');if(a)a.pause()}
document.getElementById('mx').addEventListener('click',closeM);
modal.addEventListener('click',function(e){if(e.target===modal)closeM()});
function card(t){DATA[t.id]=t;
var b='<div class="card">';
b+='<div class="im" data-d="'+t.id+'">';
if(t.cover)b+='<img loading="lazy" src="/api/v1/cover?url='+encodeURIComponent(t.cover)+'" alt="">';
if(t.streamable)b+='<button class="pbtn" data-p="'+t.id+'" aria-label="'+T.prev+'">▶</button>';
b+='</div><div class="b"><div class="t">'+es(t.title)+'</div><div class="a">'+es(t.artist)+'</div><div class="badges">';
if(t.duration)b+='<span class="badge">'+t.duration+'</span>';
if(t.genre)b+='<span class="badge">'+es(t.genre)+'</span>';
if(t.plays)b+='<span class="badge">▶'+fd(t.plays)+'</span>';
if(t.downloadable)b+='<span class="badge hot">'+T.dl+'</span>';
b+='</div></div><div class="actions">';
if(t.streamable)b+='<button class="btn mini ghost" data-p="'+t.id+'">'+T.prev+'</button>';
b+='<button class="btn mini ghost" data-d="'+t.id+'">'+T.details+'</button>';
if(t.downloadable)b+='<a class="btn mini" href="/api/v1/download?id='+encodeURIComponent(t.sid)+'">'+T.dl+'</a>';
b+='</div></div>';return b}
function openModal(id){var t=DATA[id];if(!t)return;
document.getElementById('mtitle').textContent=t.title||'';
document.getElementById('martist').textContent=(t.artist||'');
var img=document.getElementById('mimg');
if(t.cover){img.src='/api/v1/cover?url='+encodeURIComponent(t.cover);img.style.display=''}else img.style.display='none';
var st='';if(t.plays)st+='<span>▶ '+fd(t.plays)+' '+T.plays+'</span>';if(t.likes)st+='<span>♥ '+fd(t.likes)+' '+T.likes+'</span>';if(t.duration)st+='<span>⏱ '+t.duration+'</span>';
document.getElementById('mstat').innerHTML=st;
var bg='';if(t.genre)bg+='<span class="badge">'+es(t.genre)+'</span>';if(t.license)bg+='<span class="badge">'+es(t.license)+'</span>';if(t.tag_list)bg+='<span class="badge">'+es(t.tag_list)+'</span>';
document.getElementById('mbadges').innerHTML=bg;
document.getElementById('mplayer').innerHTML=t.streamable?'<audio controls preload="none" src="/api/v1/stream?id='+encodeURIComponent(t.sid)+'"></audio>':(t.page_url?'<div class="desc">'+T.hls+'</div>':'');
document.getElementById('mdesc').innerHTML=t.description?'<div class="desc">'+es(t.description)+'</div>':'';
var rows='';
if(t.downloadable)rows+='<div class="dlrow"><span class="l">'+T.dl+'</span><a class="btn mini" href="/api/v1/download?id='+encodeURIComponent(t.sid)+'">'+T.dl+'</a></div>';
if(t.page_url)rows+='<div class="dlrow"><span class="l">SoundCloud</span><a class="btn mini ghost" href="'+t.page_url+'" target="_blank" rel="noopener">'+T.open+'</a></div>';
document.getElementById('mdl').innerHTML=rows;
modal.classList.add('open');
// lazily fetch full details (description/tags/waveform)
fetch('/api/v1/track?id='+encodeURIComponent(t.sid)).then(function(r){return r.json()}).then(function(d){
var k=d.track;if(!k)return;
if(k.description)document.getElementById('mdesc').innerHTML='<div class="desc">'+es(k.description)+'</div>';
var b2='';if(k.genre)b2+='<span class="badge">'+es(k.genre)+'</span>';if(k.license)b2+='<span class="badge">'+es(k.license)+'</span>';if(k.tag_list)b2+='<span class="badge">'+es(k.tag_list)+'</span>';
if(b2)document.getElementById('mbadges').innerHTML=b2;
}).catch(function(){})}
try{var form=document.getElementById('sform'),out=document.getElementById('results');
form.addEventListener('submit',function(ev){ev.preventDefault();
var q=document.getElementById('q').value.trim();if(!q)return;addRecent(q);
out.innerHTML='<div class="grid">'+('<div class="sk"></div>').repeat(8)+'</div>';
fetch('/api/v1/search?q='+encodeURIComponent(q)+'&lang='+L)
.then(function(r){return r.json()}).then(function(d){
out.innerHTML=(d.results&&d.results.length)?'<div class="grid">'+d.results.map(card).join('')+'</div>':'<p style="text-align:center;color:var(--mut);padding:2rem">'+T.none+'</p>'})
.catch(function(e){out.innerHTML='<p style="text-align:center;color:var(--mut);padding:2rem">'+T.net+'</p>';show(e.message)})});
out.addEventListener('click',function(e){
// Handle preview first: its button sits inside the row's data-d container.
var b=e.target.closest('[data-p]');
if(b){
  var pid=b.getAttribute('data-p'),pt=DATA[pid];
  if(!pt)return;
  openModal(pid);
  setTimeout(function(){var a=document.querySelector('#mplayer audio');if(a){a.play().catch(function(){})}},80);
  return;
}
var d=e.target.closest('[data-d]');if(d){openModal(d.getAttribute('data-d'));return}
})}catch(e){show(e.message)}
})();
</script>
</body>
</html>`;
}

function openapiSpec(base) {
  return { openapi: "3.0.3", info: { title: "SoundCloud Music API", version: "2.0.0",
    description: "Search, preview & download from SoundCloud. Auto client_id; no keys needed." },
    servers: [{ url: base }],
    paths: {
      "/api/v1/search": { get: { summary: "Search SoundCloud tracks" } },
      "/api/v1/track": { get: { summary: "Track details (+description, transcodings)" } },
      "/api/v1/stream": { get: { summary: "Stream proxy by id (Range)" } },
      "/api/v1/download": { get: { summary: "Download proxy by id" } },
      "/api/v1/cover": { get: { summary: "Cover image proxy" } },
      "/health": { get: { summary: "Health" } } } };
}

/* -------------------------------- handler ------------------------------- */
const csp = n => `default-src 'none'; script-src 'nonce-${n}'; style-src 'nonce-${n}'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
const ckey = r => r.headers.get("CF-Connecting-IP") || "anon";
const authed = (r, c) => !c.apiKeys || c.apiKeys.includes(
  r.headers.get("x-api-key") || (r.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));

function present(t, base, lang) {
  return { id: t.id, sid: t.id.replace(/^sc_/, ""), source: "soundcloud",
    title: t.title, artist: t.artist,
    duration: fmtDur(t.duration_ms, lang === "fa"), duration_ms: t.duration_ms,
    cover: t.cover, page_url: t.page_url, genre: t.genre, license: t.license,
    plays: t.plays, likes: t.likes, created_at: t.created_at,
    streamable: t.streamable, previewable: !!t.streamable, hasProgressive: !!t.hasProgressive,
    hasHls: !!t.hasHls, downloadable: !!t.downloadable };
}

export default {
  async fetch(request, env) {
    const reqId = rid(), url = new URL(request.url), path = url.pathname;
    const cfg = getConfig(env), kv = env.CACHE_KV || null;
    const sc = new SoundCloud(cfg.soundcloudClientId, kv);
    const cors = { 'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    try {
      if (request.method === "OPTIONS") return new Response(null, { headers: cors });

      /* ---------- legacy endpoints (original API, unchanged shape) ---------- */
      const legacy = async (fn) => {
        await sc.init();
        return new Response(JSON.stringify(await fn()),
          { headers: { ...cors, 'Content-Type': 'application/json' } });
      };
      const need = (k) => url.searchParams.get(k) ||
        new Response(JSON.stringify({ error: `Parameter "${k}" is required` }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

      if (path === "/search" && request.method === "GET") {
        const q = need("q"); if (q instanceof Response) return q;
        return legacy(async () => (await sc.searchMusic(q)).map(t => ({
          id: t.sid || t.id.replace(/^sc_/, ""), name: t.title, picture: t.cover,
          release: t.created_at, genre: t.genre, duration: t.duration_ms,
          soundcloudurl: t.page_url })));
      }
      if (path === "/music" && request.method === "GET") {
        const id = need("id"); if (id instanceof Response) return id;
        return legacy(async () => {
          const m = await sc.getMusic(id);
          if (!m) return false;
          return { status: true, id, picture: m.cover, title: m.title,
            release: m.created_at, genre: m.genre, duration: m.duration_ms, soundcloudurl: m.page_url };
        });
      }
      if (path === "/download-url" && request.method === "GET") {
        const id = need("id"); if (id instanceof Response) return id;
        return legacy(async () => {
          const r = await sc.streamUrl(id, { allowHls: false });
          const m = await sc.getMusic(id);
          return r ? { status: true, download_url: r.url, title: m && m.title,
            duration: m && m.duration_ms, artwork: m && m.cover }
            : { status: false, status_det: "INTERNAL_ERROR" };
        });
      }
      if (path === "/direct-download" && request.method === "GET") {
        const id = need("id"); if (id instanceof Response) return id;
        await sc.init();
        const r = await sc.streamUrl(id, { allowHls: false });
        if (!r || !r.url) return new Response(JSON.stringify({ status: false, status_det: "NOT_DOWNLOADABLE" }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
        return Response.redirect(r.url, 302);
      }
      if (path === "/music-by-url" && request.method === "GET") {
        const u = need("url"); if (u instanceof Response) return u;
        return legacy(async () => {
          const m = await sc.musicByUrl(u);
          return m ? { status: true, id: m.id, picture: m.cover, title: m.title,
            release: m.created_at, genre: m.genre, duration: m.duration_ms, soundcloudurl: m.page_url } : false;
        });
      }

      /* ------------------------------ web page ---------------------------- */
      if ((path === "/" || path === "") && (request.method === "GET" || request.method === "HEAD")) {
        const acc = request.headers.get("Accept") || "";
        // Serve HTML unless the client explicitly prefers JSON (q-value aware).
        const wantsJson = /application\/json/.test(acc) && !/text\/html/.test(acc);
        if (!wantsJson) {
          const lang = url.searchParams.get("lang") === "en" ? "en" : "fa";
          const nonce = crypto.randomUUID().replace(/-/g, "");
          // Server-render results when ?q= so it works fully without JS.
          const q = (url.searchParams.get("q") || "").trim();
          let serverResults = null;
          if (q) {
            try { await sc.init();
              serverResults = await sc.searchMusic(normalizeQuery(q), { limit: 24 });
            } catch { serverResults = []; }
          }
          const html = renderPage(lang, nonce, { q, results: serverResults, origin: url.origin });
          const h = new Headers();
          h.set("Content-Type", "text/html; charset=utf-8");
          h.set("Content-Security-Policy", csp(nonce));
          h.set("X-Content-Type-Options", "nosniff");
          h.set("X-Frame-Options", "DENY");
          h.set("Cache-Control", "private, no-store");
          return new Response(request.method === "HEAD" ? null : html, { headers: h });
        }
        return json({ name: "SoundCloud Music API", version: "2.0.0", docs: "/openapi.json",
          endpoints: ["/api/v1/search", "/api/v1/track", "/api/v1/stream", "/api/v1/download", "/api/v1/cover", "/health", "/openapi.json"] }, {}, reqId);
      }

      if (path === "/health" && request.method === "GET") {
        let ok = true;
        if (url.searchParams.get("deep") === "1") {
          try { await sc.init(); ok = true; } catch { ok = false; }
        }
        return json({ status: "ok", kv: !!kv, soundcloud: { configured: true, healthy: ok } }, {}, reqId);
      }
      if (path === "/openapi.json" && request.method === "GET")
        return json(openapiSpec(url.origin), {}, reqId);

      /* ------------------------------- API -------------------------------- */
      if (path.startsWith("/api/v1/")) {
        if (!authed(request, cfg)) return err("UNAUTHORIZED", {}, reqId);
        const isMedia = /stream|download|cover/.test(path);
        const rl = await rateLimit(kv, (isMedia ? "m" : "s") + ":" + ckey(request),
          isMedia ? cfg.rateMedia : cfg.rateSearch, cfg.rateWindowSec);
        if (!rl.allowed) return err("RATE_LIMITED", { retry_after: rl.retry }, reqId);
        const lang = url.searchParams.get("lang") === "en" ? "en" : "fa";

        if (path === "/api/v1/search") {
          const q = url.searchParams.get("q");
          if (!q || !q.trim()) return err("BAD_REQUEST", { param: "q" }, reqId);
          const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
          const qn = normalizeQuery(q);
          const ck = `s:${qn}:${page}`;
          if (kv) { try { const c = await kv.get(ck, "json"); if (c) return json(c, {}, reqId); } catch {} }
          try { await sc.init(); } catch { return err("UPSTREAM", {}, reqId); }
          let results;
          try { results = await sc.searchMusic(qn, { limit: 24, offset: (page - 1) * 24 }); }
          catch { return err("UPSTREAM", {}, reqId); }
          const body = { query: q, page, count: results.length,
            results: results.map(t => present(t, url.origin, lang)) };
          if (kv) try { await kv.put(ck, JSON.stringify(body), { expirationTtl: cfg.cacheTTL }); } catch {}
          const res = json(body, {}, reqId);
          res.headers.set("Cache-Control", `public, max-age=${cfg.cacheTTL}`);
          return res;
        }

        if (path === "/api/v1/track") {
          const id = url.searchParams.get("id"); if (!id) return err("BAD_REQUEST", { param: "id" }, reqId);
          try { await sc.init(); } catch { return err("UPSTREAM", {}, reqId); }
          let m; try { m = await sc.getMusic(id); } catch { return err("UPSTREAM", {}, reqId); }
          if (!m) return err("NOT_FOUND", { id }, reqId);
          return json({ track: { ...present(m, url.origin, lang), description: m.description,
            tag_list: m.tag_list, waveform_url: m.waveform_url, transcodings: m.transcodings,
            hasProgressive: (m.transcodings || []).some(x => x.protocol === "progressive"),
            downloadable: !!m.downloadable } }, {}, reqId);
        }

        if (path === "/api/v1/stream") {
          const id = url.searchParams.get("id"); if (!id) return err("BAD_REQUEST", { param: "id" }, reqId);
          try { await sc.init(); } catch { return err("UPSTREAM", {}, reqId); }
          let r; try { r = await sc.streamUrl(id); } catch { return err("UPSTREAM", {}, reqId); }
          if (!r || !r.url) return err("NOT_FOUND", { id }, reqId);
          if (r.hls) return proxyHlsAsAudio(r.url, request, cfg, null);
          const res = await proxyMedia(r.url, request, cfg, "audio");
          return res;
        }

        if (path === "/api/v1/download") {
          const id = url.searchParams.get("id"); if (!id) return err("BAD_REQUEST", { param: "id" }, reqId);
          try { await sc.init(); } catch { return err("UPSTREAM", {}, reqId); }
          const m = await sc.getMusic(id);
          if (!m) return err("NOT_FOUND", { id }, reqId);
          // Resolve the real file: true download_url, progressive audio, or HLS reassembled as M4A.
          let r; try { r = await sc.streamUrl(id); } catch { return err("UPSTREAM", {}, reqId); }
          if (!r || !r.url) return err("NOT_DOWNLOADABLE", { id }, reqId);
          if (r.hls) return proxyHlsAsAudio(r.url, request, cfg, m.title || "track");
          const res = await proxyMedia(r.url, request, cfg, "audio", { strictAudio: true });
          if (res instanceof Response && res.ok) res.headers.set("Content-Disposition",
            `attachment; filename*=UTF-8''${encodeURIComponent((m.title || "track").replace(/[^\w؀-ۿ -]/g, "_"))}`);
          return res;
        }

        if (path === "/api/v1/cover") {
          const target = url.searchParams.get("url"); if (!target) return err("BAD_REQUEST", { param: "url" }, reqId);
          if (!validMedia(target)) return err("BAD_REQUEST", {}, reqId);
          return proxyMedia(target, request, cfg, "image");
        }
        return err("NOT_FOUND", {}, reqId);
      }

      return err("NOT_FOUND", {}, reqId);
    } catch (e) {
      return err("INTERNAL", { detail: String(e && e.message || e) }, reqId);
    }
  },
};

// Exported for reuse (e.g. inside a Telegram bot). Usage:
//   import worker, { SoundCloud } from "./worker.js";
//   const sc = new SoundCloud(); await sc.init();
//   const tracks = await sc.searchMusic("امیر تتلو");
//   const media = await sc.streamUrl(track.sid);   // { url, file, hls }
export { SoundCloud };
