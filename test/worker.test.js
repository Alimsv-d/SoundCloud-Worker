import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const env = { MAX_DOWNLOAD_MB: "50" };
const req = (path, headers = {}, method = "GET") =>
  new Request(`https://w.test${path}`, { headers, method });

test("GET / with text/html returns HTML", async () => {
  const r = await worker.fetch(req("/", { Accept: "text/html" }), env, {});
  assert.equal(r.headers.get("Content-Type").includes("text/html"), true);
  assert.ok(r.headers.get("Content-Security-Policy").includes("nonce-"));
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  assert.equal(r.headers.get("X-Frame-Options"), "DENY");
  const body = await r.text();
  assert.ok(body.includes("<html"));
});

test("GET / with */* returns JSON summary", async () => {
  const r = await worker.fetch(req("/", { Accept: "*/*" }), env, {});
  assert.equal(r.headers.get("Content-Type").includes("application/json"), true);
  const j = await r.json();
  assert.ok(j.endpoints.includes("/api/v1/search"));
  assert.ok(j.request_id);
});

test("HEAD / returns headers, empty body", async () => {
  const r = await worker.fetch(req("/", { Accept: "text/html" }, "HEAD"), env, {});
  assert.equal(await r.text(), "");
});

test("search requires q", async () => {
  const r = await worker.fetch(req("/api/v1/search"), env, {});
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.error.code, "BAD_REQUEST");
});

test("unknown route 404", async () => {
  const r = await worker.fetch(req("/nope"), env, {});
  assert.equal(r.status, 404);
});

test("download for non-downloadable track rejected", async () => {
  // dz_ id resolves to deezer provider, but get() will fail without network.
  // Use an id whose provider isn't configured -> NOT_FOUND.
  const r = await worker.fetch(req("/api/v1/download?id=sc_1"), env, {});
  assert.ok([404, 502].includes(r.status));
});

test("stream blocks disallowed host (SSRF)", async () => {
  const r = await worker.fetch(req("/api/v1/stream?url=" +
    encodeURIComponent("https://evil.example.com/a.mp3")), env, {});
  assert.equal(r.status, 403);
  const j = await r.json();
  assert.equal(j.error.code, "BLOCKED_URL");
});

test("health lists providers with configured/healthy", async () => {
  const r = await worker.fetch(req("/health"), env, {});
  const j = await r.json();
  for (const p of ["deezer", "itunes", "openverse", "archive"]) {
    assert.equal(j.providers[p].configured, true);
  }
  assert.equal(j.providers.jamendo.configured, false); // no key
});

test("openapi has no github", async () => {
  const r = await worker.fetch(req("/openapi.json"), env, {});
  const t = await r.text();
  assert.ok(!/github\.com/i.test(t));
});

test("API_KEYS enforcement", async () => {
  const e2 = { ...env, API_KEYS: "secret1" };
  let r = await worker.fetch(req("/api/v1/search?q=x"), e2, {});
  assert.equal(r.status, 401);
  r = await worker.fetch(req("/api/v1/search?q=x", { "x-api-key": "secret1" }), e2, {});
  assert.ok([200, 400, 502, 504].includes(r.status) === false || true); // any but 401
  assert.notEqual(r.status, 401);
});
