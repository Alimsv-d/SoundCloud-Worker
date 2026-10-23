// Normalized track shape:
// { id, source, title, artist, duration_ms, cover, preview_url, page_url,
//   downloadable, downloads:[{label,url}], license }

export function track(t) {
  // Ensure unique download labels
  const seen = new Set();
  const downloads = (t.downloads || []).filter(Boolean).map((d, i) => {
    let label = d.label && String(d.label).trim() ? String(d.label).trim() : `option-${i + 1}`;
    while (seen.has(label)) label = `${label}-${i + 1}`;
    seen.add(label);
    return { label, url: d.url };
  });
  return { ...t, downloadable: downloads.length > 0 && t.downloadable !== false, downloads };
}
