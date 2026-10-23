import { fetchJson } from "../lib/upstream.js";
import { track } from "./base.js";

// Internet Archive: advancedsearch + metadata + downloadable files.
export const iarchive = {
  name: "archive",
  configured: true,

  async search(q, { timeout, limit = 15, page = 1 } = {}) {
    const params = new URLSearchParams({
      q: `${q} AND mediatype:audio`,
      fl: "identifier,title,creator,downloads",
      rows: String(limit),
      page: String(page),
      output: "json",
    });
    const data = await fetchJson(`https://archive.org/advancedsearch.php?${params}`, { timeout });
    const docs = data.response?.docs || [];
    return docs.map((m) => track({
      id: `ia_${m.identifier}`,
      source: "archive",
      title: Array.isArray(m.title) ? m.title[0] : m.title,
      artist: Array.isArray(m.creator) ? m.creator[0] : m.creator,
      duration_ms: null,
      cover: `https://archive.org/services/img/${m.identifier}`,
      preview_url: null,
      page_url: `https://archive.org/details/${m.identifier}`,
      downloadable: true,
      // downloads resolved lazily at /track via files list; here we offer the item page
      downloads: [{ label: "files", url: `https://archive.org/metadata/${m.identifier}` }],
      license: "public",
      _identifier: m.identifier,
    }));
  },

  async get(id, { timeout } = {}) {
    const mid = id.replace(/^ia_/, "");
    const data = await fetchJson(`https://archive.org/metadata/${mid}`, { timeout });
    if (!data || !data.metadata) return null;
    const meta = data.metadata;
    const files = (data.files || []).filter((f) =>
      /audio\//.test(f.format ? "" : "") ||
      /\.(mp3|ogg|flac|m4a|wav)$/i.test(f.name || "") ||
      /(MP3|Ogg|FLAC|VBR|64Kbps|128Kbps)/i.test(f.format || ""));
    const downloads = files.slice(0, 8).map((f, i) => ({
      label: f.format ? `${f.format}` : `option-${i + 1}`,
      url: `https://archive.org/download/${mid}/${encodeURIComponent(f.name)}`,
    }));
    return track({
      id: `ia_${mid}`, source: "archive",
      title: Array.isArray(meta.title) ? meta.title[0] : meta.title,
      artist: Array.isArray(meta.creator) ? meta.creator[0] : meta.creator,
      duration_ms: null,
      cover: `https://archive.org/services/img/${mid}`,
      preview_url: downloads[0]?.url || null,
      page_url: `https://archive.org/details/${mid}`,
      downloadable: downloads.length > 0,
      downloads, license: "public",
    });
  },

  async health({ timeout } = {}) {
    await fetchJson(`https://archive.org/advancedsearch.php?q=test&rows=1&output=json`, { timeout });
    return true;
  },
};
