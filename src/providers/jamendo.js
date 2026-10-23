import { fetchJson } from "../lib/upstream.js";
import { track } from "./base.js";

// Jamendo: requires JAMENDO_CLIENT_ID. Only tracks with audiodownload_allowed.
export function makeJamendo(clientId) {
  return {
    name: "jamendo",
    configured: !!clientId,

    async search(q, { timeout, limit = 15 } = {}) {
      if (!clientId) return [];
      const params = new URLSearchParams({
        client_id: clientId, format: "json", limit: String(limit),
        search: q, include: "musicinfo", audioformat: "mp32",
      });
      const data = await fetchJson(`https://api.jamendo.com/v3.0/tracks/?${params}`, { timeout });
      return (data.results || []).map((m) => track({
        id: `jm_${m.id}`, source: "jamendo", title: m.name, artist: m.artist_name,
        duration_ms: (m.duration || 0) * 1000, cover: m.album_image || m.image,
        preview_url: m.audio, page_url: m.shareurl,
        downloadable: !!m.audiodownload_allowed && !!m.audiodownload,
        downloads: m.audiodownload_allowed && m.audiodownload
          ? [{ label: "MP3", url: m.audiodownload }] : [],
        license: m.license_ccurl || "cc",
      }));
    },

    async get(id, { timeout } = {}) {
      if (!clientId) return null;
      const mid = id.replace(/^jm_/, "");
      const data = await fetchJson(
        `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&id=${mid}`,
        { timeout });
      const m = (data.results || [])[0];
      if (!m) return null;
      return track({
        id: `jm_${m.id}`, source: "jamendo", title: m.name, artist: m.artist_name,
        duration_ms: (m.duration || 0) * 1000, cover: m.album_image || m.image,
        preview_url: m.audio, page_url: m.shareurl,
        downloadable: !!m.audiodownload_allowed && !!m.audiodownload,
        downloads: m.audiodownload_allowed && m.audiodownload
          ? [{ label: "MP3", url: m.audiodownload }] : [],
        license: m.license_ccurl || "cc",
      });
    },

    async health({ timeout } = {}) {
      if (!clientId) return false;
      await fetchJson(`https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=1`, { timeout });
      return true;
    },
  };
}
