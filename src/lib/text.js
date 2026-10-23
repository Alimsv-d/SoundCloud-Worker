// Persian/Arabic text normalization and utilities.
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalizeQuery(input) {
  if (input == null) return "";
  let s = String(input);
  // Arabic/Persian variants -> standard Persian
  s = s.replace(/ي/g, "ی").replace(/ى/g, "ی").replace(/ك/g, "ک");
  // ZWNJ normalization: spaces around ZWNJ collapse
  s = s.replace(/\u200c+/g, "\u200c");
  // Normalize digits to ASCII for matching
  s = s.replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c)));
  s = s.replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c)));
  // Remove diacritics & tatweel
  s = s.replace(/[ً-ٟـ]/g, "");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function detectLang(q) {
  return /[؀-ۿ]/.test(q || "") ? "fa" : "en";
}

export function fmtDuration(ms) {
  if (ms == null || isNaN(ms)) return null;
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function escapeAttr(s) { return escapeHtml(s); }
