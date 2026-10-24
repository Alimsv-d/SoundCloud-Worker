# SoundCloud Music — Cloudflare Worker

سرویس وب تک‌فایلی برای **جستجو، پیش‌نمایش و دانلود موسیقی از SoundCloud** روی Cloudflare Workers — همه‌چیز در یک فایل `worker.js`.

A single-file web service to **search, preview and download music from SoundCloud** on Cloudflare Workers — everything lives in `worker.js`.

> ⚠️ **هشدار صادقانه / Honest disclaimer**
> این سرویس از **API غیررسمی وب SoundCloud** استفاده می‌کند و ممکن است بدون اطلاع قبلی از کار بیفتد. هیچ فایلی روی سرور میزبانی یا ذخیره نمی‌شود — همه‌چیز مستقیم از CDN ساندکلاد جریان می‌یابد. حق نشر هر اثر متعلق به صاحب آن است.
> This uses the **unofficial SoundCloud web API** and may break without notice. Nothing is hosted or stored — everything streams from the SoundCloud CDN. Copyright belongs to the owners.

---

## فارسی

### امکانات
- جستجو، پیش‌نمایش و دانلود ترک‌های SoundCloud
- `client_id` به‌صورت خودکار از سایت SoundCloud گرفته می‌شود — **بدون هیچ سکرت لازم نیست**
- دانلود فایل مستقیم (progressive) و همچنین **چسباندن خودکار استریم HLS** به یک فایل صوتی (mp3/ogg/m4a)
- رابط وب فارسی/انگلیسی با تم روشن/تیره
- پنج مسیر legacy با همان شکل JSON نسخه‌ی اصلی + مسیرهای `/api/v1/*`
- بدون KV هم کار می‌کند (کش و rate-limit در حافظه)؛ با KV از KV استفاده می‌کند

### دیپلوی یک‌کلیکی
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Alimsv-d/SoundCloud-Worker)

دکمه `worker.js` را **بدون هیچ فیلد اجباری** دیپلوی می‌کند.

### دیپلوی دستی (کپی در داشبورد)
1. Cloudflare Dashboard → **Workers & Pages → Create Worker** → محتوای `worker.js` را paste کنید → **Deploy**.
2. (اختیاری) یک KV namespace به نام `CACHE_KV` بسازید و به‌عنوان `CACHE_KV` bind کنید تا کش/rate-limit پایدار شود.
3. (اختیاری) سکرت‌های `SOUNDCLOUD_CLIENT_ID` و `API_KEYS` را تنظیم کنید.

### دیپلوی با GitHub Actions (workflow دستی)
Workflow `deploy.yml` با `workflow_dispatch` اجرا می‌شود. دو سکرت در ریپو لازم است:
- `CLOUDFLARE_API_TOKEN` (توکن با دسترسی Edit Workers)
- `CLOUDFLARE_ACCOUNT_ID`

سپس: **Actions → Deploy to Cloudflare Workers → Run workflow**.

### نصب روی دستگاه‌ها
- **اندروید (Termux):** `pkg install nodejs git` → کلون ریپو → `npx wrangler deploy`
- **ویندوز:** نصب Node.js → `npm i -g wrangler` → `wrangler login` → `wrangler deploy`
- **لینوکس:** نصب Node.js → `npm i -g wrangler` → `wrangler login` → `wrangler deploy`
- **cPanel / هاست اشتراکی:** این یک Cloudflare Worker است و روی cPanel اجرا نمی‌شود؛ فقط کافی است `worker.js` را در داشبورد Cloudflare paste کنید.

### متغیرهای محیطی
| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `MAX_DOWNLOAD_MB` | `100` | سقف حجم دانلود (مگابایت) |
| `CACHE_TTL_SECONDS` | `300` | TTL کش جستجو |
| `UPSTREAM_TIMEOUT_MS` | `12000` | مهلت درخواست به SoundCloud |
| `RATE_LIMIT_SEARCH` | `40` | سقف جستجو در پنجره |
| `RATE_LIMIT_MEDIA` | `90` | سقف مدیا در پنجره |
| `RATE_LIMIT_WINDOW_SEC` | `60` | طول پنجره‌ی rate-limit (ثانیه) |
| `MAX_HLS_SEGMENTS` | `1500` | سقف تعداد سگمنت HLS |
| `SUBREQUEST_LIMIT` | `45` | سقف subrequest در هر درخواست (پلن رایگان ۵۰ است؛ این مقدار حاشیه امن می‌گذارد) |
| `LONG_TRACK_MODE` | `browser` | رفتار برای ترک طولانی: `browser` / `error` / `direct` |
| `ALLOWED_ORIGINS` | `*` | مقدار `Access-Control-Allow-Origin` |
| `API_KEYS` | — | (سکرت) فعال‌سازی احراز `x-api-key` روی `/api/v1/*` |
| `SOUNDCLOUD_CLIENT_ID` | — | (سکرت) override برای client_id خودکار |
| `CACHE_KV` | — | (binding) KV اختیاری برای کش/rate-limit پایدار |

### اندپوینت‌ها
**API v1** (پاسخ `{ok:true, request_id, ...}`):
- `GET /api/v1/search?q=…&page=1&lang=fa` — جستجو
- `GET /api/v1/track?id=…` — جزئیات ترک
- `GET /api/v1/stream?id=…` — استریم (پشتیبانی Range/206)
- `GET /api/v1/download?id=…` — دانلود؛ `?check=1` → `{mode,ext,segments,size}`
- `GET /api/v1/hls?id=…` — manifest بازنویسی‌شده برای دانلود مرورگر
- `GET /api/v1/hls-seg?u=…` — پروکسی تک‌سگمنت (ضد SSRF)
- `GET /api/v1/resolve?url=…` — تبدیل لینک SoundCloud به ترک
- `GET /api/v1/cover?url=…` — پروکسی کاور
- `GET /health` (و `?deep=1`) · `GET /openapi.json`

**Legacy** (شکل JSON نسخه‌ی اصلی):
- `GET /search?q=…` → آرایه‌ی `{id,picture,name,release,genre,duration,soundcloudurl}`
- `GET /music?id=…` → `{status,id,picture,title,…}` یا `false`
- `GET /download-url?id=…` → `{status,download_url,title,duration,artwork}`
- `GET /direct-download?id=…` → ریدایرکت 302
- `GET /music-by-url?url=…`

### محدودیت پلن رایگان (مهم)
Cloudflare Workers به‌ازای هر درخواست یک سقف **subrequest** دارد: **پلن رایگان = ۵۰** و **Workers Paid = ۱۰٬۰۰۰** ([مستندات رسمی](https://developers.cloudflare.com/workers/platform/limits/#subrequests)).
- ترک‌های **progressive** و **HLS کوتاه** همیشه مستقیم و سروری دانلود می‌شوند.
- ترک **HLS بلند** که به بیش از `SUBREQUEST_LIMIT` سگمنت نیاز دارد، روی پلن رایگان نمی‌تواند در یک درخواست سروری ساخته شود. با `LONG_TRACK_MODE`:
  - `browser` (پیش‌فرض): UI سگمنت‌ها را از `/api/v1/hls-seg` می‌گیرد و در مرورگر به فایل می‌چسباند — روی هر پلنی کار می‌کند.
  - `error`: پاسخ `413 TRACK_TOO_LONG`.
  - `direct`: تلاش سروری (فقط روی Workers Paid امن است).
- روی **Workers Paid** مقدار `SUBREQUEST_LIMIT` را بالا ببرید (مثلاً `5000`) و `LONG_TRACK_MODE=direct` بگذارید تا همه‌ی ترک‌ها سروری دانلود شوند.
- بیشینه‌ی مدت تقریبی دانلود مستقیم روی پلن رایگان ≈ `SUBREQUEST_LIMIT` × مدت هر سگمنت (معمولاً ~۱۰ ثانیه) ≈ **چند دقیقه**.

### کدهای خطا
`BAD_REQUEST` `NOT_FOUND` `UNAUTHORIZED` `RATE_LIMITED` `UPSTREAM_ERROR` `UPSTREAM_TIMEOUT` `PAYLOAD_TOO_LARGE` `NOT_DOWNLOADABLE` `TRACK_TOO_LONG` `INTERNAL_ERROR`

### مثال‌ها
```bash
curl 'https://<worker>.workers.dev/api/v1/search?q=tatloo'
curl 'https://<worker>.workers.dev/api/v1/download?id=1554652312' -o track.mp3
```
```python
import requests
r = requests.get("https://<worker>.workers.dev/api/v1/search", params={"q": "tataloo"})
print(r.json()["results"][0]["title"])
```
```php
$j = json_decode(file_get_contents("https://<worker>.workers.dev/api/v1/search?q=tataloo"));
echo $j->results[0]->title;
```
```js
const r = await fetch("https://<worker>.workers.dev/api/v1/search?q=tataloo");
const { results } = await r.json();
```

---

## English

### Features
- Search, preview & download SoundCloud tracks
- `client_id` is **auto-scraped** — no secret required
- Direct-file downloads plus **automatic HLS→audio reassembly** (mp3/ogg/m4a)
- Long-HLS tracks: **free plan = 50 subrequests/request** → browser-segmented download; **Workers Paid = 10,000** → set `SUBREQUEST_LIMIT` + `LONG_TRACK_MODE=direct`
- Persian/English web UI with light/dark theme
- Five legacy endpoints with the exact original JSON shape, plus `/api/v1/*`
- Works with **no KV** (in-memory cache & rate-limit); uses KV when bound

### Deploy
- **One click:** the Deploy button above — zero required fields.
- **Manual:** paste `worker.js` into the Workers editor → Deploy.
- **GitHub Actions:** set `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo secrets → run the `deploy.yml` workflow.
- **Local/OS:** `npm i -g wrangler` → `wrangler login` → `wrangler deploy` (Termux on Android, Node on Windows/Linux). It is a Worker, so it does not run on cPanel — just paste the file into the Cloudflare dashboard.

See the variable table and endpoint list above (they are language-neutral). Error JSON looks like:
```json
{ "ok": false, "request_id": "…", "error": { "code": "NOT_FOUND", "message": { "fa": "…", "en": "Not found" } } }
```

---

ساخته‌شده توسط **علی موسوی (AliMsvD)** · [t.me/AliMsvD](https://t.me/AliMsvD)
