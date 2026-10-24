import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const env = { MAX_DOWNLOAD_MB: "100" };
const req = (p, h = {}, method = "GET") => new Request(`https://w.test${p}`, { headers: h, method });

const TRACK = (over = {}) => ({
  id: 1, kind: "track", streamable: true, title: "Song",
  artwork_url: "https://i1.sndcdn.com/a-large.jpg", user: { avatar_url: "https://i1.sndcdn.com/u-large.jpg" },
  track_authorization: "t", media: { transcodings: [] }, ...over
});

function fakeFetch(handlers) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    const url = String(u);
    for (const [match, fn] of handlers) if (match(url)) return fn(url, o);
    return Response.json({}, { status: 404 });
  };
  return () => { globalThis.fetch = orig };
}
const baseH = [
  [u => u === "https://soundcloud.com/", () => new Response('<script src="https://a-v2.sndcdn.com/assets/a.js"></script>')],
  [u => u.startsWith("https://a-v2.sndcdn.com/assets/"), () => new Response('x,client_id:"cid"')],
];

const dlReq = id => req(`/api/v1/download?id=${id}`);

test("progressive download returns audio + Content-Disposition", async () => {
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "progressive", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc/p" }] } });
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/p"), () => Response.json({ url: "https://cf-media.sndcdn.com/x.mp3" })],
    [u => u === "https://cf-media.sndcdn.com/x.mp3", () => new Response("MP3DATA", { headers: { "Content-Type": "audio/mpeg", "Content-Length": "7" } })],
  ]);
  try {
    const r = await worker.fetch(dlReq(1), env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Content-Type"), "application/octet-stream");
    const cd = r.headers.get("Content-Disposition") || "";
    assert.ok(/attachment/.test(cd) && /\.mp3/.test(cd) && /filename\*=UTF-8''/.test(cd));
    assert.equal(await r.text(), "MP3DATA");
  } finally { restore(); }
});

test("HLS mp3 (no MAP) concatenates segments and uses .mp3", async () => {
  const manifest = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6\nseg1.mp3\n#EXTINF:6\nseg2.mp3\n#EXT-X-ENDLIST";
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "hls", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc/h" }] } });
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/h"), () => Response.json({ url: "https://cf-hls.sndcdn.com/pl.m3u8" })],
    [u => u === "https://cf-hls.sndcdn.com/pl.m3u8", () => new Response(manifest)],
    [u => /seg[12]\.mp3$/.test(u), () => new Response("MP3", { headers: { "Content-Type": "audio/mpeg" } })],
  ]);
  try {
    const r = await worker.fetch(dlReq(1), env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Content-Type"), "application/octet-stream");
    assert.ok(/\.mp3/.test(r.headers.get("Content-Disposition") || ""));
    assert.equal(await r.text(), "MP3MP3");
  } finally { restore(); }
});

test("HLS mp4 with EXT-X-MAP includes init segment and uses .m4a", async () => {
  const manifest = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6\ns1.m4s\n#EXT-X-ENDLIST';
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "hls", mime_type: "audio/mp4" }, url: "https://api-v2.soundcloud.com/tc/h" }] } });
  const order = [];
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/h"), () => Response.json({ url: "https://cf-hls.sndcdn.com/pl.m3u8" })],
    [u => u === "https://cf-hls.sndcdn.com/pl.m3u8", () => new Response(manifest)],
    [u => /init\.mp4$/.test(u), () => { order.push("init"); return new Response("INIT"); }],
    [u => /s1\.m4s$/.test(u), () => { order.push("s1"); return new Response("SEG"); }],
  ]);
  try {
    const r = await worker.fetch(dlReq(1), env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Content-Type"), "application/octet-stream");
    assert.ok(/\.m4a/.test(r.headers.get("Content-Disposition") || ""));
    assert.equal(await r.text(), "INITSEG");
    assert.deepEqual(order, ["init", "s1"]);
  } finally { restore(); }
});

test("HLS opus maps to .ogg / audio/ogg without requiring MAP", async () => {
  const manifest = "#EXTM3U\n#EXTINF:6\no1.opus\n#EXT-X-ENDLIST";
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "hls", mime_type: "audio/ogg; codecs=opus" }, url: "https://api-v2.soundcloud.com/tc/h" }] } });
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/h"), () => Response.json({ url: "https://cf-hls.sndcdn.com/pl.m3u8" })],
    [u => u === "https://cf-hls.sndcdn.com/pl.m3u8", () => new Response(manifest)],
    [u => /o1\.opus$/.test(u), () => new Response("OPUS")],
  ]);
  try {
    const r = await worker.fetch(dlReq(1), env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Content-Type"), "application/octet-stream");
    assert.ok(/\.ogg/.test(r.headers.get("Content-Disposition") || ""));
    assert.equal(await r.text(), "OPUS");
  } finally { restore(); }
});

test("file larger than MAX_DOWNLOAD_MB is rejected", async () => {
  const e2 = { MAX_DOWNLOAD_MB: "1" };
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "progressive", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc/p" }] } });
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/p"), () => Response.json({ url: "https://cf-media.sndcdn.com/big.mp3" })],
    [u => u === "https://cf-media.sndcdn.com/big.mp3", () => new Response("x", { headers: { "Content-Type": "audio/mpeg", "Content-Length": String(2 * 1048576) } })],
  ]);
  try {
    const r = await worker.fetch(dlReq(1), e2);
    assert.equal(r.status, 413);
  } finally { restore(); }
});

test("upstream error surfaces a JSON error, not a crash", async () => {
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "progressive", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc/p" }] } });
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/p"), () => Response.json({ url: "https://cf-media.sndcdn.com/x.mp3" })],
    [u => u === "https://cf-media.sndcdn.com/x.mp3", () => new Response("err", { status: 503 })],
  ]);
  try {
    const r = await worker.fetch(dlReq(1), env);
    const j = await r.json();
    assert.equal(j.ok, false);
    assert.ok(j.error && j.error.code);
  } finally { restore(); }
});

test("?check=1 returns mode+ext without downloading bytes", async () => {
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "hls", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc/h" }] } });
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/h"), () => Response.json({ url: "https://cf-hls.sndcdn.com/pl.m3u8" })],
    [u => u === "https://cf-hls.sndcdn.com/pl.m3u8", () => new Response("#EXTM3U\n#EXTINF:6\ns.mp3\n#EXT-X-ENDLIST")],
  ]);
  try {
    const r = await worker.fetch(req("/api/v1/download?id=1&check=1"), env);
    const j = await r.json();
    assert.ok(j.ok && j.ext === "mp3" && typeof j.segments === "number");
  } finally { restore(); }
});

test("short HLS downloads directly & fully (server-side)", async () => {
  const manifest = "#EXTM3U\n#EXTINF:6\ns1.mp3\n#EXTINF:6\ns2.mp3\n#EXT-X-ENDLIST";
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "hls", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc/h" }] } });
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/h"), () => Response.json({ url: "https://cf-hls.sndcdn.com/pl.m3u8" })],
    [u => u === "https://cf-hls.sndcdn.com/pl.m3u8", () => new Response(manifest)],
    [u => /s[12]\.mp3$/.test(u), () => new Response("MP3", { headers: { "Content-Type": "audio/mpeg" } })],
  ]);
  try {
    const r = await worker.fetch(dlReq(1), env);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "MP3MP3");
  } finally { restore(); }
});

test("long track + LONG_TRACK_MODE=error -> 413 TRACK_TOO_LONG", async () => {
  const e2 = { MAX_DOWNLOAD_MB: "100", SUBREQUEST_LIMIT: "5", LONG_TRACK_MODE: "error" };
  const segs = Array.from({ length: 20 }, (_, i) => `#EXTINF:6\ns${i}.mp3`).join("\n");
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "hls", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc/h" }] } });
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/h"), () => Response.json({ url: "https://cf-hls.sndcdn.com/pl.m3u8" })],
    [u => u === "https://cf-hls.sndcdn.com/pl.m3u8", () => new Response("#EXTM3U\n" + segs + "\n#EXT-X-ENDLIST")],
  ]);
  try {
    const r = await worker.fetch(dlReq(1), e2);
    assert.equal(r.status, 413);
    const j = await r.json();
    assert.equal(j.error.code, "TRACK_TOO_LONG");
    assert.ok(j.error.max_direct_seconds > 0);
  } finally { restore(); }
});

test("long track + LONG_TRACK_MODE=browser -> check=1 mode:browser", async () => {
  const e2 = { MAX_DOWNLOAD_MB: "100", SUBREQUEST_LIMIT: "5", LONG_TRACK_MODE: "browser" };
  const segs = Array.from({ length: 20 }, (_, i) => `#EXTINF:6\ns${i}.mp3`).join("\n");
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "hls", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc/h" }] } });
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/h"), () => Response.json({ url: "https://cf-hls.sndcdn.com/pl.m3u8" })],
    [u => u === "https://cf-hls.sndcdn.com/pl.m3u8", () => new Response("#EXTM3U\n" + segs + "\n#EXT-X-ENDLIST")],
  ]);
  try {
    const r = await worker.fetch(req("/api/v1/download?id=1&check=1"), e2);
    const j = await r.json();
    assert.equal(j.mode, "browser");
    assert.equal(j.segments, 20);
  } finally { restore(); }
});

test("mid-stream segment failure errors the stream (no silent short file)", async () => {
  const manifest = "#EXTM3U\n#EXTINF:6\nok1.mp3\n#EXTINF:6\nBAD.mp3\n#EXTINF:6\nok2.mp3\n#EXT-X-ENDLIST";
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "hls", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc/h" }] } });
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/h"), () => Response.json({ url: "https://cf-hls.sndcdn.com/pl.m3u8" })],
    [u => u === "https://cf-hls.sndcdn.com/pl.m3u8", () => new Response(manifest)],
    [u => /ok[12]\.mp3$/.test(u), () => new Response("OK")],
    [u => /BAD\.mp3$/.test(u), () => new Response("err", { status: 500 })],
  ]);
  try {
    const r = await worker.fetch(dlReq(1), env);
    assert.equal(r.status, 200);
    await assert.rejects(() => r.text(), "stream should error mid-way");
  } finally { restore(); }
});

test("regression: strictAudio accepts audio/mpeg (was i is not defined)", async () => {
  const m = TRACK({ media: { transcodings: [{ format: { protocol: "progressive", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc/p" }] } });
  const restore = fakeFetch([...baseH,
    [u => /tracks\/1(\?|$)/.test(u), () => Response.json(m)],
    [u => u.startsWith("https://api-v2.soundcloud.com/tc/p"), () => Response.json({ url: "https://cf-media.sndcdn.com/x.mp3" })],
    [u => u === "https://cf-media.sndcdn.com/x.mp3", () => new Response("MP3DATA", { headers: { "Content-Type": "audio/mpeg" } })],
  ]);
  try {
    const r = await worker.fetch(dlReq(1), env);
    assert.equal(r.status, 200, "must not throw i is not defined");
    assert.equal(r.headers.get("Content-Type"), "application/octet-stream");
  } finally { restore(); }
});

test("hls-seg proxy blocks non-SoundCloud hosts (SSRF)", async () => {
  const r = await worker.fetch(req("/api/v1/hls-seg?u=" + encodeURIComponent("https://evil.com/s")), env);
  assert.equal(r.status, 400);
});

test("CORS present on /health, /openapi.json, api and streams", async () => {
  for (const p of ["/health", "/openapi.json"]) {
    const r = await worker.fetch(req(p), env);
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*", p);
  }
});

test("/?format=json returns the original JSON contract", async () => {
  const r = await worker.fetch(req("/?format=json", { Accept: "text/html" }), env);
  const j = await r.json();
  assert.equal(j.message, "SoundCloud API Worker");
  assert.ok(j.endpoints["/search?q={query}"]);
});

test("rate limit (in-memory, no KV) trips after cap", async () => {
  const e = { MAX_DOWNLOAD_MB: "100", RATE_LIMIT_SEARCH: "2", RATE_LIMIT_WINDOW_SEC: "60" };
  let limited = 0;
  for (let i = 0; i < 4; i++) {
    const r = await worker.fetch(req("/?q=x" + i, { Accept: "text/html" }), e);
    if (r.status === 429) limited++;
  }
  assert.ok(limited >= 1, "expected at least one 429");
});

test("OPTIONS preflight returns CORS headers", async () => {
  const r = await worker.fetch(req("/api/v1/search", {}, "OPTIONS"), env);
  assert.ok(r.headers.get("Access-Control-Allow-Origin"));
});

test("no github string in /, /?lang=en, /openapi.json, /health, 404", async () => {
  for (const p of ["/", "/?lang=en", "/openapi.json", "/health", "/nope"]) {
    const t = await (await worker.fetch(req(p, { Accept: "text/html" }), env)).text();
    assert.ok(!/github/i.test(t), p + " contains github");
  }
});
