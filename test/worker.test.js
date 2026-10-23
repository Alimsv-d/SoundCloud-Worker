import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

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
  assert.ok(j.endpoints.includes("/api/v1/search"));
  assert.ok(j.request_id);
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

test("API_KEYS enforcement", async () => {
  const e2 = { ...env, API_KEYS: "secret1" };
  let r = await worker.fetch(req("/api/v1/search?q=x"), e2);
  assert.equal(r.status, 401);
  r = await worker.fetch(req("/api/v1/search?q=x", { "x-api-key": "secret1" }), e2);
  assert.notEqual(r.status, 401);
});
