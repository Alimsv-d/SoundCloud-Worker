import { fetchJson } from "../lib/upstream.js";
import { track } from "./base.js";

export const itunes = {
  name: "itunes",
  configured: true,

  async search(q, { timeout, limit = 15 } = {}) {
    const data = await fetchJson(
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}`,
      { timeout });
    return (data.results || []).map((m) => track({
      id: `it_${m.trackId}`,
      source: "itunes",
      title: m.trackName,
      artist: m.artistName,
      duration_ms: m.trackTimeMillis,
      cover: m.artworkUrl100,
      preview_url: m.previewUrl,
      page_url: m.trackViewUrl,
      downloadable: false,
      downloads: [],
      license: "preview",
    }));
  },

  async get(id, { timeout } = {}) {
    const mid = id.replace(/^it_/, "");
    const data = await fetchJson(`https://itunes.apple.com/lookup?id=${mid}&entity=song`, { timeout });
    const m = (data.results || [])[0];
    if (!m) return null;
    return track({
      id: `it_${m.trackId}`, source: "itunes", title: m.trackName, artist: m.artistName,
      duration_ms: m.trackTimeMillis, cover: m.artworkUrl100, preview_url: m.previewUrl,
      page_url: m.trackViewUrl, downloadable: false, downloads: [], license: "preview",
    });
  },

  async health({ timeout } = {}) {
    await fetchJson(`https://itunes.apple.com/search?term=test&limit=1`, { timeout });
    return true;
  },
};
