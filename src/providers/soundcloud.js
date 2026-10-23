import { fetchJson } from "../lib/upstream.js";
import { track } from "./base.js";

// SoundCloud API v2: requires a client_id (SOUNDCLOUD_CLIENT_ID).
export function makeSoundCloud(clientId) {
  return {
    name: "soundcloud",
    configured: !!clientId,

    async search(q, { timeout, limit = 15 } = {}) {
      if (!clientId) return [];
      const params = new URLSearchParams({
        q, client_id: clientId, limit: String(limit), offset: "0",
        linked_partitioning: "1",
      });
      const data = await fetchJson(`https://api-v2.soundcloud.com/search/tracks?${params}`, { timeout });
      return (data.collection || []).filter((m) => m.kind === "track").map((m) => this._norm(m));
    },

    _norm(m) {
      const art = (m.artwork_url || m.user?.avatar_url || "").replace("large", "t500x500") || null;
      return track({
        id: `sc_${m.id}`, source: "soundcloud", title: m.title,
        artist: m.user?.username, duration_ms: m.duration, cover: art,
        preview_url: m.stream_url ? `${m.stream_url}?client_id=${clientId}` : null,
        page_url: m.permalink_url,
        downloadable: !!m.downloadable && !!m.download_url,
        downloads: m.downloadable && m.download_url
          ? [{ label: "original", url: `${m.download_url}?client_id=${clientId}` }] : [],
        license: m.license || "all-rights-reserved",
      });
    },

    async get(id, { timeout } = {}) {
      if (!clientId) return null;
      const mid = id.replace(/^sc_/, "");
      const m = await fetchJson(`https://api-v2.soundcloud.com/tracks/${mid}?client_id=${clientId}`, { timeout });
      if (!m || !m.id) return null;
      return this._norm(m);
    },

    async health({ timeout } = {}) {
      if (!clientId) return false;
      const res = await fetch(`https://api-v2.soundcloud.com/tracks?client_id=${clientId}&limit=1`, {
        signal: AbortSignal.timeout(timeout) });
      return res.ok;
    },
  };
}
