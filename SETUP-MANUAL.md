# SETUP-MANUAL — راهنمای راه‌اندازی

## English

The whole service is **one file: `worker.js`**. No build step required.

### Option A — Paste in Dashboard (simplest)
1. Cloudflare Dashboard → **Workers & Pages → Create Worker** → **paste `worker.js`** → **Deploy**.
2. (Optional) **Workers & Pages → KV → Create** a namespace named `CACHE_KV`, then Worker → **Settings → Bindings → KV → Add** → variable `CACHE_KV`.
3. (Optional) Worker → **Settings → Variables → Secrets** → add `SOUNDCLOUD_CLIENT_ID`, `JAMENDO_CLIENT_ID`, `API_KEYS`.
4. (Optional) Non-secret vars under **Settings → Variables** — see table below.

### Option B — Deploy button
Click the **Deploy to Cloudflare** button in README — deploys `worker.js` automatically, no required fields.

### Option C — wrangler CLI
```bash
npx wrangler login
npx wrangler kv:namespace create CACHE_KV   # paste printed id into wrangler.toml
npx wrangler deploy                          # deploys worker.js via main field
```

### Option D — GitHub Action
Repo → **Settings → Secrets → Actions**, add `CLOUDFLARE_API_TOKEN` (**Workers Scripts + KV Edit**) and `CLOUDFLARE_ACCOUNT_ID`. Run the **Deploy** workflow (workflow_dispatch).

### Non-secret variables (wrangler.toml [vars])
| Var | Default | Meaning |
|-----|---------|---------|
| `MAX_DOWNLOAD_MB` | 50 | Download size cap |
| `CACHE_TTL_SECONDS` | 60 | Search cache TTL (KV) |
| `UPSTREAM_TIMEOUT_MS` | 10000 | Upstream + body timeout |
| `RATE_LIMIT_SEARCH` / `RATE_LIMIT_MEDIA` | 30 / 60 | Per-window request caps |
| `RATE_LIMIT_WINDOW_SEC` | 60 | Rate-limit window |
| `CDN_ALLOWLIST` | see file | Media host allowlist |

### Mobile note
The Git-connected repo may not appear in the mobile dashboard editor — use the **Deploy button**, the **Action**, or **wrangler**.

---

## فارسی

کل سرویس **یک فایل است: `worker.js`**. نیازی به build نیست.

### روش الف — کپی در داشبورد (ساده‌ترین)
1. داشبورد → Workers & Pages → Create Worker → محتوای `worker.js` را بچسبانید → Deploy.
2. (اختیاری) KV با نام `CACHE_KV` بسازید و bind کنید.
3. (اختیاری) Secretها را اضافه کنید: `SOUNDCLOUD_CLIENT_ID`، `JAMENDO_CLIENT_ID`، `API_KEYS`.

### روش ب — دکمهٔ Deploy
دکمهٔ Deploy to Cloudflare در README — به‌صورت خودکار `worker.js` را دیپلوی می‌کند.

### روش ج — wrangler / روش د — GitHub Action
مانند بالا. برای Action دو Secret `CLOUDFLARE_API_TOKEN` (با مجوز Workers Scripts + KV Edit) و `CLOUDFLARE_ACCOUNT_ID` لازم است.

### نکتهٔ موبایل
مخزن متصل به Git ممکن است در ویرایشگر موبایل دیده نشود — از دکمهٔ Deploy، Action یا wrangler استفاده کنید.
