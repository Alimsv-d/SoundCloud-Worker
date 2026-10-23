# Music Search & Download — Cloudflare Worker

سرویس وب تک‌فایلی برای **جستجو، پیش‌نمایش و دانلود موسیقی** از منابع قانونی روی Cloudflare Workers — همه‌چیز در یک فایل `worker.js`.

A single-file web service for **searching, previewing and downloading music** from legal sources on Cloudflare Workers — everything lives in `worker.js`.

## English

Aggregates **Deezer, iTunes, Openverse, Internet Archive** (keyless, always on) plus optional **Jamendo** and **SoundCloud** (API key). Results are merged & de-duplicated. Downloads go through an SSRF-hardened media proxy and are only offered where the source allows.

The **entire service is one file: `worker.js`** — no build step, no modules, no dependencies. Deploy it directly.

### Deploy (one click)
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Alimsv-d/SoundCloud-Worker)

The button deploys `worker.js` with **no required fields** — runs fully on keyless sources.

### Deploy manually (paste)
1. Cloudflare Dashboard → **Workers & Pages → Create Worker** → **paste `worker.js`** → Deploy.
2. (Optional) Create a KV namespace `CACHE_KV` and bind it as `CACHE_KV` for rate-limit/caching.
3. (Optional) Add Secrets: `SOUNDCLOUD_CLIENT_ID`, `JAMENDO_CLIENT_ID`, `API_KEYS`.

Or via wrangler: `npx wrangler kv:namespace create CACHE_KV` (paste id into `wrangler.toml`), then `npx wrangler deploy`.

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

### Optional secrets (Dashboard → Settings → Variables → Secrets)
| Secret | Effect |
|--------|--------|
| `SOUNDCLOUD_CLIENT_ID` | Enable SoundCloud source |
| `JAMENDO_CLIENT_ID` | Enable Jamendo source |
| `API_KEYS` | Comma-separated keys; if set, `/api/v1` requires `x-api-key`/`Bearer` |

### API Token permissions (for wrangler/Action deploy)
- **Workers Scripts** (Edit) · **KV Storage** (Edit)

### Legal
Only proxies public, legal sources; hosts no files. Copyright belongs to owners; takedown on request. The Iranian-artist catalog in these legal sources is limited.

---

## فارسی

این سرویس تک‌فایلی جستجو را در چند منبع قانونی (Deezer، iTunes، Openverse، Internet Archive و در صورت تنظیم کلید، Jamendo و SoundCloud) انجام می‌دهد و نتایج را ادغام و تکراری‌ها را حذف می‌کند. دانلود فقط جایی فعال است که منبع اجازه دهد و از پروکسی امن ضد SSRF عبور می‌کند.

**کل سرویس یک فایل است: `worker.js`** — بدون build، بدون وابستگی.

### دیپلوی یک‌کلیکی
دکمهٔ «Deploy to Cloudflare» بالا را بزنید — بدون هیچ فیلد اجباری `worker.js` بالا می‌آید.

### دیپلوی دستی (کپی)
1. داشبورد کلادفلر → Workers & Pages → Create Worker → محتوای `worker.js` را بچسبانید → Deploy.
2. (اختیاری) KV با نام `CACHE_KV` بسازید و bind کنید.
3. (اختیاری) Secretها را اضافه کنید.

### ملاحظات حقوقی
هیچ فایلی میزبانی نمی‌شود؛ همهٔ رسانه‌ها از CDN منبع پخش می‌شوند. کاتالوگ هنرمندان ایرانی در این منابع محدود است.
