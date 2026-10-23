// Configuration from env with safe defaults.
export function getConfig(env) {
  const num = (v, d) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const list = (v, d) =>
    (v ? String(v).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : d);

  return {
    maxDownloadMB: num(env.MAX_DOWNLOAD_MB, 50),
    cacheTTL: num(env.CACHE_TTL_SECONDS, 60),
    upstreamTimeoutMs: num(env.UPSTREAM_TIMEOUT_MS, 10000),
    rateSearch: num(env.RATE_LIMIT_SEARCH, 30),
    rateMedia: num(env.RATE_LIMIT_MEDIA, 60),
    rateWindowSec: num(env.RATE_LIMIT_WINDOW_SEC, 60),
    upstreamAllow: list(env.UPSTREAM_ALLOWLIST, [
      "api.deezer.com", "itunes.apple.com", "api.openverse.org",
      "archive.org", "api.jamendo.com", "api-v2.soundcloud.com",
      "api.soundcloud.com", "soundcloud.com", "a-v2.sndcdn.com",
      "api.soundcloud.com",
    ]),
    cdnAllow: list(env.CDN_ALLOWLIST, [
      "sndcdn.com", "dzcdn.net", "mzstatic.com", "jamendo.com",
      "jamendo.net", "archive.org", "us.archive.org", "ia800300.us.archive.org",
      "ia601409.us.archive.org", "ia801409.us.archive.org", "prod-images.openverse.org",
      "api.openverse.org",
    ]),
    apiKeys: list(env.API_KEYS, null),
    jamendoClientId: env.JAMENDO_CLIENT_ID || null,
    soundcloudClientId: env.SOUNDCLOUD_CLIENT_ID || null,
  };
}

export function hostMatches(host, allowlist) {
  host = (host || "").toLowerCase();
  return allowlist.some((d) => host === d || host.endsWith("." + d));
}
