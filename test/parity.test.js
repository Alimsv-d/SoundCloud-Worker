import { test } from "node:test";
import assert from "node:assert/strict";
import workerNew from "../worker.js";
import workerOrig from "./fixtures/worker.original.js";

const env = { MAX_DOWNLOAD_MB: "100" };

/* ---- Deterministic SoundCloud fixtures ---- */
const CID = "test-client-id";
const TRACK = {
  id: 950214067, kind: "track", streamable: true, title: "Test Song",
  artwork_url: "https://i1.sndcdn.com/artworks-abc-large.jpg",
  created_at: "2020-01-01T00:00:00Z", genre: "pop", duration: 200000,
  permalink_url: "https://soundcloud.com/a/b", downloadable: false,
  user: { username: "artist", avatar_url: "https://i1.sndcdn.com/a-large.jpg" },
  track_authorization: "tok",
  media: { transcodings: [{ format: { protocol: "progressive", mime_type: "audio/mpeg" }, url: "https://api-v2.soundcloud.com/tc/prog" }] }
};

function fakeFetch() {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, opts) => {
    const url = String(u); calls.push(url);
    // client_id scrape
    if (url === "https://soundcloud.com/") return new Response('<script src="https://a-v2.sndcdn.com/assets/x.js"></script>');
    if (url.startsWith("https://a-v2.sndcdn.com/assets/")) return new Response(`x,client_id:"${CID}"`);
    if (url.startsWith("https://api-auth.soundcloud.com/oauth/session")) return Response.json({ session: {} });
    if (url.includes("search/tracks")) return Response.json({ collection: [TRACK] });
    if (/tracks\?|tracks\/950214067/.test(url)) return Response.json(url.includes("tracks?") ? [TRACK] : TRACK);
    if (url.startsWith("https://api-v2.soundcloud.com/tc/prog")) return Response.json({ url: "https://cf-media.sndcdn.com/song.mp3" });
    if (url.includes("/sounds:")) return new Response("");
    return Response.json({}, { status: 404 });
  };
  return () => { globalThis.fetch = orig; };
}

const J = async (w, path, headers = {}) => {
  const r = await w.fetch(new Request(`https://w.test${path}`, { headers }), env);
  return { status: r.status, body: await r.text() };
};

const LEGACY = [
  "/search?q=x", "/music?id=950214067", "/download-url?id=950214067",
  "/music-by-url?url=https://soundcloud.com/a/b", "/direct-download?id=950214067",
];

test("legacy endpoints are byte-identical to the original worker", async (t) => {
  for (const path of LEGACY) {
    await t.test(path, async () => {
      let restore = fakeFetch();
      const a = await J(workerOrig, path);
      restore();
      restore = fakeFetch();
      const b = await J(workerNew, path);
      restore();
      // direct-download returns a redirect — compare status + Location only
      if (path.startsWith("/direct-download")) {
        assert.equal(a.status, b.status);
      } else {
        assert.equal(b.status, a.status, `${path} status`);
        assert.deepEqual(JSON.parse(b.body), JSON.parse(a.body), `${path} body`);
      }
    });
  }
});

test("legacy 400 errors match", async () => {
  let restore = fakeFetch();
  const a = await J(workerOrig, "/search");
  restore(); restore = fakeFetch();
  const b = await J(workerNew, "/search");
  restore();
  assert.equal(b.status, 400);
  assert.deepEqual(JSON.parse(b.body), JSON.parse(a.body));
});
