import { fetchJson } from "../lib/upstream.js";
import { track } from "./base.js";

const API = "https://api.deezer.com";

export const deezer = {
  name: "deezer",
  configured: true, // keyless

  async search(q, { timeout, limit = 15 } = {}) {
    const data = await fetchJson(`${API}/search?q=${encodeURIComponent(q)}&limit=${limit}&index=0`, { timeout });
    return (data.data || []).map((m) => track({
      id: `dz_${m.id}`,
      source: "deezer",
      title: m.title,
      artist: m.artist?.name || null,
      duration_ms: (m.duration || 0) * 1000,
      cover: m.album?.cover_medium || m.album?.cover || null,
      preview_url: m.preview || null,
      page_url: m.link,
      downloadable: false, // preview only, not full download
      downloads: [],
      license: "preview",
    }));
  },

  async get(id, { timeout } = {}) {
    const mid = id.replace(/^dz_/, "");
    const m = await fetchJson(`${API}/track/${mid}`, { timeout });
    if (m.error) return null;
    return track({
      id: `dz_${m.id}`, source: "deezer", title: m.title,
      artist: m.artist?.name, duration_ms: (m.duration || 0) * 1000,
      cover: m.album?.cover_medium || m.album?.cover, preview_url: m.preview,
      page_url: m.link, downloadable: false, downloads: [], license: "preview",
    });
  },

  async health({ timeout } = {}) {
    await fetchJson(`${API}/infos`, { timeout });
    return true;
  },
};
