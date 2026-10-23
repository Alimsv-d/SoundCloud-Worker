import { CircuitBreaker, UpstreamError } from "../lib/upstream.js";
import { deezer } from "./deezer.js";
import { itunes } from "./itunes.js";
import { openverse } from "./openverse.js";
import { iarchive } from "./iarchive.js";
import { makeJamendo } from "./jamendo.js";
import { makeSoundCloud } from "./soundcloud.js";
import { normalizeQuery } from "../lib/text.js";

export function buildProviders(cfg) {
  const list = [
    deezer, itunes, openverse, iarchive,
    makeJamendo(cfg.jamendoClientId),
    makeSoundCloud(cfg.soundcloudClientId),
  ];
  const breakers = {};
  for (const p of list) breakers[p.name] = new CircuitBreaker(p.name);
  return { list, breakers };
}

function dedupKey(t) {
  return `${(t.title || "").toLowerCase()}|${(t.artist || "").toLowerCase()}`.slice(0, 120);
}

export async function searchAll(prov, q, { source, page = 1, timeout, perPage = 12 } = {}) {
  const qn = normalizeQuery(q);
  const active = prov.list.filter((p) =>
    p.configured && (!source || source === "all" || p.name === source));

  const settled = await Promise.allSettled(active.map((p) =>
    prov.breakers[p.name].call(() => p.search(qn, { timeout, limit: perPage, page }))));

  const merged = [];
  const seen = new Set();
  const providerErrors = {};
  settled.forEach((r, i) => {
    const name = active[i].name;
    if (r.status === "fulfilled") {
      for (const t of r.value) {
        const k = dedupKey(t);
        if (!seen.has(k)) { seen.add(k); merged.push(t); }
      }
    } else {
      providerErrors[name] = r.reason instanceof UpstreamError ? r.reason.kind : "error";
    }
  });

  // Prefer downloadable/CC first, keep source diversity
  merged.sort((a, b) => (b.downloadable - a.downloadable));

  return { results: merged, providerErrors, query: qn, page };
}

export function findProvider(prov, id) {
  const prefix = (id || "").split("_")[0];
  const map = { dz: "deezer", it: "itunes", ov: "openverse", ia: "archive", jm: "jamendo", sc: "soundcloud" };
  const name = map[prefix];
  return prov.list.find((p) => p.name === name) || null;
}
