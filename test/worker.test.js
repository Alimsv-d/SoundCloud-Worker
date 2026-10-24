import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { SoundCloud } from "../worker.js";

const env = { MAX_DOWNLOAD_MB: "100" };
const req = (path, headers = {}, method = "GET") => new Request(`https://w.test${path}`, { headers, method });

test("GET / text/html returns HTML with CSP nonce", async () => {
  const r = await worker.fetch(req("/", { Accept: "text/html" }), env);
  assert.ok(r.headers.get("Content-Type").includes("text/html"));
  assert.ok(r.headers.get("Content-Security-Policy").includes("nonce-"));
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  assert.equal(r.headers.get("X-Frame-Options"), "DENY");
  const body = await r.text();
  assert.ok(body.includes("<html"));
  for (const id of ["how", "api", "faq", "terms", "results", "burger", "nav", "modal"])
    assert.ok(body.includes(`id="${id}"`), `missing ${id}`);
});

test("download links preserve native browser save for progressive tracks", async () => {
  const html = await (await worker.fetch(req("/"), env)).text();
  assert.match(html, /data-direct=/);
  assert.doesNotMatch(html, /data-direct="1"[^>]*target=/i);
  assert.match(html, /if\(dl\.getAttribute\('data-direct'\)==='1'\)return/);
});

test("server-rendered progressive download link is native and carries .mp3", async () => {
  const originalFetch = globalThis.fetch;
  const track = {
    id: 123, kind: "track", streamable: true, title: "Test Track", duration: 1000,
    created_at: "2025-01-01T00:00:00Z", genre: "", permalink_url: "https://soundcloud.com/a/test",
    artwork_url: "https://i1.sndcdn.com/a-large.jpg", user: { username: "Artist", avatar_url: "https://i1.sndcdn.com/u-large.jpg" },
    media: { transcodings: [{ format: { protocol: "progressive", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc" }] }
  };
  globalThis.fetch = async (input) => {
    const u = String(input);
    if (u === "https://soundcloud.com/") return new Response('<script src="https://a-v2.sndcdn.com/assets/a.js"></script>');
    if (u.startsWith("https://a-v2.sndcdn.com/assets/")) return new Response('x,client_id:"cid"');
    if (u.includes("search/tracks")) return Response.json({ collection: [track] });
    return Response.json({}, { status: 404 });
  };
  try {
    const html = await (await worker.fetch(req("/?q=test", { Accept: "text/html" }), env)).text();
    assert.match(html, /data-direct="1"[^>]*download="Test Track - Artist\.mp3"/);
    assert.match(html, /href="https:\/\/w\.test\/api\/v1\/download\?id=123"/);
  } finally { globalThis.fetch = originalFetch; }
});

test("no stray opacity:0 (only reveal/modal/pbtn)", async () => {
  const r = await worker.fetch(req("/", { Accept: "text/html" }), env);
  const html = await r.text();
  assert.ok(html.includes("html.js .reveal{opacity:0"));
  // content must be visible by default: .reveal only hidden under html.js
  const allowed = (html.match(/html\.js \.reveal\{opacity:0/g) || []).length +
                  (html.match(/\.modal\{[^}]*opacity:0/g) || []).length +
                  (html.match(/\.pbtn\{[^}]*opacity:0/g) || []).length;
  assert.equal(html.split("opacity:0").length - 1, allowed, "stray opacity:0");
  assert.ok(html.includes("[hidden]{display:none!important}"));
  assert.ok(!/on(click|error|load|submit)=/i.test(html), "inline handler");
});

test("all inline scripts in rendered HTML parse", async () => {
  const html = await (await worker.fetch(req("/", { Accept: "text/html" }), env)).text();
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1]).filter(s => s.trim());
  assert.ok(scripts.length >= 2);
  for (const [i, script] of scripts.entries()) {
    assert.doesNotThrow(() => new Function(script), `inline script ${i} has syntax error`);
  }
});

test("interactive list has delegated preview and detail handlers", async () => {
  const html = await (await worker.fetch(req("/", { Accept: "text/html" }), env)).text();
  assert.match(html, /e\.target\.closest\('\[data-p\]'\)/);
  assert.match(html, /e\.target\.closest\('\[data-d\]'\)/);
  assert.match(html, /openModal\(pid\)/);
  assert.match(html, /mplayer.*audio/s);
});

test("server-rendered shell supports no-JS search contract", async () => {
  const html = await (await worker.fetch(req("/", { Accept: "text/html" }), env)).text();
  assert.match(html, /action="\/" method="get"/);
  assert.match(html, /id="seed"/);
  assert.match(html, /id="results"/);
});

test("no github link; rtl + telegram footer", async () => {
  const html = await (await worker.fetch(req("/", { Accept: "text/html" }), env)).text();
  assert.ok(!/github\.com/i.test(html));
  assert.ok(/t\.me\/AliMsvD/.test(html));
  assert.ok(html.includes('dir="rtl"'));
});

test("GET / returns HTML by default; JSON only for explicit application/json", async () => {
  let r = await worker.fetch(req("/", { Accept: "*/*" }), env);
  assert.ok(r.headers.get("Content-Type").includes("text/html"), "*/* should get HTML");
  r = await worker.fetch(req("/", { Accept: "application/json" }), env);
  assert.ok(r.headers.get("Content-Type").includes("application/json"));
  const j = await r.json();
  // Exact original shape.
  assert.equal(j.message, "SoundCloud API Worker");
  assert.ok(j.endpoints["/search?q={query}"]);
});

test("HEAD / empty body", async () => {
  assert.equal(await (await worker.fetch(req("/", { Accept: "text/html" }, "HEAD"), env)).text(), "");
});

test("search requires q (api + legacy)", async () => {
  assert.equal((await worker.fetch(req("/api/v1/search"), env)).status, 400);
  assert.equal((await worker.fetch(req("/search"), env)).status, 400);
});

test("unknown route 404", async () => {
  assert.equal((await worker.fetch(req("/nope"), env)).status, 404);
});

test("cover blocks non-soundcloud host", async () => {
  const r = await worker.fetch(req("/api/v1/cover?url=" + encodeURIComponent("https://evil.com/a.png")), env);
  assert.equal(r.status, 400);
});

test("openapi has no github", async () => {
  const t = await (await worker.fetch(req("/openapi.json"), env)).text();
  assert.ok(!/github\.com/i.test(t));
});

test("media resolution returns no file for HLS-only tracks", async () => {
  const sc = new SoundCloud("fixed-client-id");
  const m = { media: { transcodings: [{ format: { protocol: "hls", mime_type: "audio/mp4" } }] } };
  assert.equal(await sc._resolveMedia(m, false), null);
});

test("media resolution keeps progressive stream as a real file", async () => {
  const sc = new SoundCloud("fixed-client-id");
  const m = { track_authorization: "x", media: { transcodings: [
    { format: { protocol: "hls", mime_type: "audio/mp4" }, url: "https://hls.example" },
    { format: { protocol: "progressive", mime_type: "audio/mpeg" }, url: "https://progressive.example" },
  ] } };
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (u) => { requested = String(u); return Response.json({ url: "https://cf-media.sndcdn.com/song.mp3" }); };
  try {
    const media = await sc._resolveMedia(m, false);
    assert.equal(media.file, true);
    assert.equal(media.hls, undefined);
    assert.equal(media.url, "https://cf-media.sndcdn.com/song.mp3");
    assert.ok(requested.startsWith("https://progressive.example"));
  } finally { globalThis.fetch = originalFetch; }
});

test("API_KEYS enforcement", async () => {
  const e2 = { ...env, API_KEYS: "secret1" };
  let r = await worker.fetch(req("/api/v1/search?q=x"), e2);
  assert.equal(r.status, 401);
  r = await worker.fetch(req("/api/v1/search?q=x", { "x-api-key": "secret1" }), e2);
  assert.notEqual(r.status, 401);
});
