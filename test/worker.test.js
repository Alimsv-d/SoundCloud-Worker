import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const env = { MAX_DOWNLOAD_MB: "50" };
const req = (path, headers = {}, method = "GET") => new Request(`https://w.test${path}`, { headers, method });

test("GET / text/html returns HTML with CSP nonce", async () => {
  const r = await worker.fetch(req("/", { Accept: "text/html" }), env);
  assert.ok(r.headers.get("Content-Type").includes("text/html"));
  assert.ok(r.headers.get("Content-Security-Policy").includes("nonce-"));
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  assert.equal(r.headers.get("X-Frame-Options"), "DENY");
  const body = await r.text();
  assert.ok(body.includes("<html"));
  // page sections present
  for (const id of ["how", "api", "faq", "terms", "results", "burger", "nav"])
    assert.ok(body.includes(`id="${id}"`), `missing ${id}`);
});

test("no opacity:0 outside html.js reveal rule", async () => {
  const r = await worker.fetch(req("/", { Accept: "text/html" }), env);
  const html = await r.text();
  assert.ok(html.includes("html.js .reveal{opacity:0"));
  assert.equal(html.split("opacity:0").length - 1, 1, "opacity:0 only under html.js");
  assert.ok(html.includes("[hidden]{display:none!important}"));
  assert.ok(!/on(click|error|load|submit)=/i.test(html), "inline handler found");
});

test("no github link in HTML; has telegram + footer", async () => {
  const r = await worker.fetch(req("/", { Accept: "text/html" }), env);
  const html = await r.text();
  assert.ok(!/github\.com/i.test(html));
  assert.ok(/t\.me\/AliMsvD/.test(html));
  assert.ok(html.includes('dir="rtl"'));
});

test("GET / */* returns JSON summary", async () => {
  const r = await worker.fetch(req("/", { Accept: "*/*" }), env);
  assert.ok(r.headers.get("Content-Type").includes("application/json"));
  const j = await r.json();
  assert.ok(j.endpoints.includes("/api/v1/search"));
  assert.ok(j.request_id);
});

test("HEAD / returns headers + empty body", async () => {
  const r = await worker.fetch(req("/", { Accept: "text/html" }, "HEAD"), env);
  assert.equal(await r.text(), "");
});

test("search requires q", async () => {
  const r = await worker.fetch(req("/api/v1/search"), env);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, "BAD_REQUEST");
});

test("unknown route 404", async () => {
  assert.equal((await worker.fetch(req("/nope"), env)).status, 404);
});

test("stream blocks disallowed host (SSRF)", async () => {
  const r = await worker.fetch(req("/api/v1/stream?url=" + encodeURIComponent("https://evil.example.com/a.mp3")), env);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error.code, "BLOCKED_URL");
});

test("health lists providers", async () => {
  const j = await (await worker.fetch(req("/health"), env)).json();
  for (const p of ["deezer", "itunes", "openverse", "archive"]) assert.equal(j.providers[p].configured, true);
  assert.equal(j.providers.jamendo.configured, false);
});

test("openapi has no github", async () => {
  const t = await (await worker.fetch(req("/openapi.json"), env)).text();
  assert.ok(!/github\.com/i.test(t));
});

test("API_KEYS enforcement", async () => {
  const e2 = { ...env, API_KEYS: "secret1" };
  let r = await worker.fetch(req("/api/v1/search?q=x"), e2);
  assert.equal(r.status, 401);
  r = await worker.fetch(req("/api/v1/search?q=x", { "x-api-key": "secret1" }), e2);
  assert.notEqual(r.status, 401);
});
