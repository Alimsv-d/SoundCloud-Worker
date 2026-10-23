# Music Search & Download — Cloudflare Worker

سرویس وب کامل برای **جستجو، پیش‌نمایش و دانلود موسیقی** از منابع قانونی روی Cloudflare Workers.

A complete web service for **searching, previewing and downloading music** from legal sources on Cloudflare Workers.

## English

Aggregates **Deezer, iTunes, Openverse, Internet Archive** (keyless, always on) plus optional **Jamendo** and **SoundCloud** (API key). Results are merged & de-duplicated. Downloads are proxied through an SSRF-hardened media proxy and are only offered where the source allows.

### Features
- Combined multi-source search with pagination & source filter
- Full Persian (RTL) UI default, English via `?lang=en`; Persian text normalization
- SSRF-safe audio/image proxy (allowlist, https:443 only, manual redirects, IP blocklist, size cap, Range)
- Rate limiting & short-lived caching via KV; ETag; request_id on every response
- Works fully keyless; optional keys only enhance coverage
- No D1, no admin panel

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Web UI (`Accept: text/html`) or JSON summary |
| GET | `/api/v1/search?q=&source=&page=&lang=` | Search |
| GET | `/api/v1/track?id=` | Track details |
| GET | `/api/v1/download?id=&index=` | Proxied download (only if allowed) |
| GET | `/api/v1/stream?url=` | Preview stream proxy (Range) |
| GET | `/api/v1/cover?url=` | Cover image proxy |
| GET | `/health?deep=1` | Health + per-provider status |
| GET | `/openapi.json` | OpenAPI spec |

### Deploy (one click)
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Alimsv-d/SoundCloud-Worker)

The button deploys with **no required fields** — the service runs fully on keyless sources.

### Optional secrets (Dashboard → Workers → Settings → Variables → Secrets)
| Secret | Effect |
|--------|--------|
| `SOUNDCLOUD_CLIENT_ID` | Enable SoundCloud source |
| `JAMENDO_CLIENT_ID` | Enable Jamendo source |
| `API_KEYS` | Comma-separated keys; if set, `/api/v1` requires `x-api-key` or `Bearer` |

### Manual deploy
```bash
npm install
npm run bundle          # builds dist/worker.js (upload this in the Dashboard editor)
# or: npx wrangler deploy  (needs API token + account id)
# create KV: npx wrangler kv:namespace create CACHE_KV  → paste id in wrangler.toml
```

### API Token permissions
- **Workers Scripts** (Edit)
- **KV Storage** (Edit)

### GitHub-connected deploy on mobile
If you connected Git in the dashboard, note the mobile web editor may not show the Git-connected repo — deploy via the **Deploy button**, **GitHub Action** (workflow_dispatch, needs the two secrets), or **wrangler CLI**.

### Legal
This service only proxies public, legal sources and hosts no files. Copyright belongs to the owners; takedown on request. The catalog of Iranian artists in these legal sources is limited.

---

## فارسی

این سرویس جستجو را در چند منبع قانونی موسیقی (Deezer، iTunes، Openverse، Internet Archive و در صورت تنظیم کلید، Jamendo و SoundCloud) انجام می‌دهد، نتایج را ادغام و تکراری‌ها را حذف می‌کند. دانلود فقط برای ترک‌هایی فعال است که منبع اجازه داده باشد و از طریق یک پروکسی امن (ضد SSRF) انجام می‌شود.

- رابط کاربری فارسی راست‌چین پیش‌فرض؛ انگلیسی با `?lang=en`
- بدون نیاز به کلید کار می‌کند؛ کلیدها فقط پوشش را بیشتر می‌کنند
- بدون D1 و بدون پنل ادمین؛ فقط KV

### دیپلوی یک‌کلیکی
دکمهٔ «Deploy to Cloudflare» بالا را بزنید — بدون هیچ فیلد اجباری سرویس بالا می‌آید.

### کلیدهای اختیاری
`SOUNDCLOUD_CLIENT_ID`، `JAMENDO_CLIENT_ID` و `API_KEYS` را از مسیر Dashboard → Workers → Settings → Variables → Secrets تنظیم کنید.

### دیپلوی دستی
```bash
npm install
npm run bundle          # dist/worker.js را در ویرایشگر داشبورد آپلود کنید
# یا: npx wrangler deploy
```

### مجوزهای API Token
- Workers Scripts (Edit)
- KV Storage (Edit)

### ملاحظات حقوقی
هیچ فایلی میزبانی نمی‌شود؛ همهٔ رسانه‌ها از CDN منبع پخش می‌شوند. کاتالوگ هنرمندان ایرانی در این منابع محدود است.
