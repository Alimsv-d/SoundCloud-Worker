# SETUP-MANUAL — راهنمای راه‌اندازی

کل سرویس **یک فایل است: `worker.js`**. بدون build، بدون وابستگی. `client_id` به‌صورت خودکار از SoundCloud گرفته می‌شود — **بدون سکرت هم کار می‌کند**.

The whole service is **one file: `worker.js`**. No build, no dependencies. `client_id` is auto-scraped — it works with **no secrets**.

> ⚠️ Uses the **unofficial SoundCloud web API** and may break without notice. Nothing is hosted or stored.
> ⚠️ از API **غیررسمی** SoundCloud استفاده می‌کند و ممکن است بدون اطلاع از کار بیفتد. هیچ فایلی ذخیره نمی‌شود.

---

## فارسی

### روش الف — دکمهٔ Deploy (ساده‌ترین)
دکمهٔ **Deploy to Cloudflare** در README — `worker.js` را خودکار و بدون هیچ فیلد اجباری دیپلوی می‌کند.

### روش ب — کپی در داشبورد
1. Cloudflare Dashboard → **Workers & Pages → Create Worker** → محتوای `worker.js` را paste کنید → **Deploy**.
2. (اختیاری) **KV → Create** یک namespace به نام `CACHE_KV` → Worker → **Settings → Bindings → KV → Add** → متغیر `CACHE_KV`.
3. (اختیاری) **Settings → Variables → Secrets** → `SOUNDCLOUD_CLIENT_ID`، `API_KEYS`.

### روش ج — wrangler CLI
```bash
npx wrangler login
npx wrangler deploy          # فایل worker.js را از فیلد main دیپلوی می‌کند
# اختیاری برای KV:
npx wrangler kv:namespace create CACHE_KV   # id چاپ‌شده را در wrangler.toml بگذارید
```

### روش د — GitHub Action (workflow دستی)
ریپو → **Settings → Secrets → Actions** و دو سکرت را بگذارید:
- `CLOUDFLARE_API_TOKEN` (با مجوز Workers Scripts Edit)
- `CLOUDFLARE_ACCOUNT_ID`

سپس **Actions → Deploy to Cloudflare Workers → Run workflow**.

### نصب روی دستگاه‌ها
- **اندروید (Termux):**
  ```bash
  pkg install nodejs git
  git clone <repo> && cd SoundCloud-Worker
  npm i -g wrangler && wrangler login && wrangler deploy
  ```
- **ویندوز:** Node.js را نصب کنید → `npm i -g wrangler` → `wrangler login` → `wrangler deploy`.
- **لینوکس:** Node.js را نصب کنید → `npm i -g wrangler` → `wrangler login` → `wrangler deploy`.
- **cPanel / هاست اشتراکی:** این یک Cloudflare Worker است و روی cPanel اجرا نمی‌شود؛ فقط `worker.js` را در داشبورد Cloudflare paste کنید.

### متغیرهای غیرسکرت (wrangler.toml [vars])
| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `MAX_DOWNLOAD_MB` | 100 | سقف حجم دانلود |
| `CACHE_TTL_SECONDS` | 300 | TTL کش جستجو |
| `UPSTREAM_TIMEOUT_MS` | 12000 | مهلت درخواست به SoundCloud |
| `RATE_LIMIT_SEARCH` / `RATE_LIMIT_MEDIA` | 40 / 90 | سقف درخواست در هر پنجره |
| `RATE_LIMIT_WINDOW_SEC` | 60 | طول پنجرهٔ rate-limit |
| `MAX_HLS_SEGMENTS` | 1500 | سقف تعداد سگمنت HLS |
| `ALLOWED_ORIGINS` | `*` | مقدار `Access-Control-Allow-Origin` |

### نکتهٔ موبایل
مخزن متصل به Git ممکن است در ویرایشگر موبایل دیده نشود — از دکمهٔ Deploy، Action یا wrangler استفاده کنید.

---

## English

### Option A — Deploy button (simplest)
Click **Deploy to Cloudflare** in the README — deploys `worker.js` automatically, no required fields.

### Option B — Paste in the dashboard
1. Cloudflare Dashboard → **Workers & Pages → Create Worker** → paste `worker.js` → **Deploy**.
2. (Optional) **KV → Create** a namespace `CACHE_KV`, then Worker → **Settings → Bindings → KV → Add** → variable `CACHE_KV`.
3. (Optional) **Settings → Variables → Secrets** → `SOUNDCLOUD_CLIENT_ID`, `API_KEYS`.

### Option C — wrangler CLI
```bash
npx wrangler login
npx wrangler deploy
npx wrangler kv:namespace create CACHE_KV   # optional; put the id in wrangler.toml
```

### Option D — GitHub Action (manual workflow)
Repo → **Settings → Secrets → Actions**, add `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit) and `CLOUDFLARE_ACCOUNT_ID`. Run **Deploy to Cloudflare Workers** (workflow_dispatch).

### Per-OS install
- **Android (Termux):** `pkg install nodejs git`, clone, `npm i -g wrangler`, `wrangler login`, `wrangler deploy`.
- **Windows/Linux:** install Node.js, `npm i -g wrangler`, `wrangler login`, `wrangler deploy`.
- **cPanel/shared host:** this is a Worker and does not run on cPanel — paste `worker.js` into the Cloudflare dashboard.
