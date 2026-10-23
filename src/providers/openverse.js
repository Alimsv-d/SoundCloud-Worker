import { fetchJson } from "../lib/upstream.js";
import { track } from "./base.js";

// Openverse: CC-licensed audio, all downloadable.
export const openverse = {
  name: "openverse",
  configured: true,

  async search(q, { timeout, limit = 15, page = 1 } = {}) {
    const data = await fetchJson(
      `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&page_size=${limit}&page=${page}`,
      { timeout });
    return (data.results || []).map((m) => track({
      id: `ov_${m.id}`,
      source: "openverse",
      title: m.title,
      artist: m.creator,
      duration_ms: m.duration,
      cover: m.thumbnail || null,
      preview_url: m.url,
      page_url: m.foreign_landing_url,
      downloadable: true,
      downloads: m.url ? [{ label: m.filetype ? m.filetype.toUpperCase() : "audio", url: m.url }] : [],
      license: m.license || "cc",
    }));
  },

  async get(id, { timeout } = {}) {
    const mid = id.replace(/^ov_/, "");
    const m = await fetchJson(`https://api.openverse.org/v1/audio/${mid}/`, { timeout });
    if (!m || !m.id) return null;
    return track({
      id: `ov_${m.id}`, source: "openverse", title: m.title, artist: m.creator,
      duration_ms: m.duration, cover: m.thumbnail, preview_url: m.url,
      page_url: m.foreign_landing_url, downloadable: !!m.url,
      downloads: m.url ? [{ label: m.filetype ? m.filetype.toUpperCase() : "audio", url: m.url }] : [],
      license: m.license || "cc",
    });
  },

  async health({ timeout } = {}) {
    await fetchJson(`https://api.openverse.org/v1/audio/?q=test&page_size=1`, { timeout });
    return true;
  },
};
