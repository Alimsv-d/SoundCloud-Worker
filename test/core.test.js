import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "parse5";
import { renderPage } from "../src/lib/ui.js";
import { normalizeQuery, fmtDuration } from "../src/lib/text.js";
import { validateMediaUrl } from "../src/lib/proxy.js";
import { getConfig } from "../src/lib/config.js";
import { track } from "../src/providers/base.js";

function htmlDom(html) { return parse(html); }
function findAll(node, tag, out = []) {
  if (node.tagName === tag) out.push(node);
  for (const c of node.childNodes || []) findAll(c, tag, out);
  return out;
}
function textOf(node) {
  let s = "";
  if (node.value) s += node.value;
  for (const c of node.childNodes || []) s += textOf(c);
  return s;
}
function attr(node, name) {
  const a = (node.attrs || []).find((x) => x.name === name);
  return a ? a.value : null;
}

const cfg = getConfig({});

test("page contains all sections", () => {
  const dom = htmlDom(renderPage({ lang: "fa", nonce: "n" }));
  const ids = ["how", "api", "faq", "terms", "results", "burger", "nav"];
  const html = renderPage({ lang: "fa", nonce: "n" });
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `missing ${id}`);
});

test("no opacity:0 outside html.js reveal rule", () => {
  const html = renderPage({ lang: "fa", nonce: "n" });
  // Only allowed occurrence is inside the `html.js .reveal` selector
  const occurrences = html.split("opacity:0").length - 1;
  assert.ok(html.includes("html.js .reveal{opacity:0"));
  assert.equal(occurrences, 1, "opacity:0 must appear only under html.js");
});

test("CSP nonce used, no inline handlers/styles", () => {
  const html = renderPage({ lang: "fa", nonce: "abc" });
  assert.ok(!/on(click|error|load|submit)=/i.test(html), "inline handler found");
  const dom = htmlDom(html);
  for (const el of findAll(dom, "script")) {
    assert.equal(attr(el, "nonce"), "abc");
  }
  for (const el of findAll(dom, "style")) {
    assert.equal(attr(el, "nonce"), "abc");
  }
});

test("no github link in UI", () => {
  const html = renderPage({ lang: "fa", nonce: "n" });
  assert.ok(!/github\.com/i.test(html));
  assert.ok(/t\.me\/AliMsvD/.test(html));
});

test("[hidden] rule and dir rtl", () => {
  const html = renderPage({ lang: "fa", nonce: "n" });
  assert.ok(html.includes("[hidden]{display:none!important}"));
  assert.ok(html.includes('dir="rtl"'));
  const en = renderPage({ lang: "en", nonce: "n" });
  assert.ok(en.includes('dir="ltr"'));
});

test("text normalization", () => {
  assert.equal(normalizeQuery("ابي"), "ابی");
  assert.equal(normalizeQuery("كردن"), "کردن");
  assert.equal(normalizeQuery("۱۲۳"), "123");
  assert.equal(normalizeQuery("آ  ب"), "آ ب");
});

test("unique download labels", () => {
  const t = track({ downloads: [{ label: "MP3", url: "a" }, { label: "MP3", url: "b" }, { url: "c" }] });
  const labels = t.downloads.map((d) => d.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(t.downloads[2].label, "option-3");
});

test("SSRF: blocks http, non-443, private IP, non-allowlist", () => {
  assert.equal(validateMediaUrl("http://cf.sndcdn.com/a", cfg).ok, false); // http
  assert.equal(validateMediaUrl("https://cf.sndcdn.com:8443/a", cfg).ok, false); // port
  assert.equal(validateMediaUrl("https://127.0.0.1/a", cfg).ok, false);
  assert.equal(validateMediaUrl("https://192.168.1.1/a", cfg).ok, false);
  assert.equal(validateMediaUrl("https://[::1]/a", cfg).ok, false);
  assert.equal(validateMediaUrl("https://evil.com/a", cfg).ok, false); // not allowlisted
  assert.equal(validateMediaUrl("https://cf-media.sndcdn.com/a.mp3", cfg).ok, true);
  assert.equal(validateMediaUrl("https://is1-ssl.mzstatic.com/img.png", cfg).ok, true);
});

test("fmtDuration", () => {
  assert.equal(fmtDuration(65000), "1:05");
  assert.equal(fmtDuration(null), null);
});
