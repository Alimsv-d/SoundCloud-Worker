# SETUP-MANUAL — راهنمای راه‌اندازی دستی

## English

### Option A — Dashboard paste (simplest, no CLI)
1. `npm install && npm run bundle` → produces `dist/worker.js` (single file).
2. Cloudflare Dashboard → **Workers & Pages** → **Create Worker** → paste `dist/worker.js` into the editor → **Deploy**.
3. Create a KV namespace: **Workers & Pages → KV → Create** named e.g. `CACHE_KV`.
4. Bind it: Worker → **Settings → Bindings → KV Namespaces → Add** → variable name `CACHE_KV`, pick the namespace.
5. (Optional) Add Secrets: `SOUNDCLOUD_CLIENT_ID`, `JAMENDO_CLIENT_ID`, `API_KEYS`.
6. (Optional) Adjust non-secret vars under **Settings → Variables** (see table below).

### Option B — wrangler CLI
```bash
npm install
npx wrangler login                        # or CLOUDFLARE_API_TOKEN env
npx wrangler kv:namespace create CACHE_KV # copy the printed id into wrangler.toml
npx wrangler deploy
```

### Option C — GitHub Action
Repo → **Settings → Secrets and variables → Actions**, add:
- `CLOUDFLARE_API_TOKEN` — needs **Workers Scripts (Edit)** + **KV Storage (Edit)**
- `CLOUDFLARE_ACCOUNT_ID`
Then run the **Deploy to Cloudflare Workers** workflow (workflow_dispatch).

### Non-secret variables (wrangler.toml [vars])
| Var | Default | Meaning |
|-----|---------|---------|
| `MAX_DOWNLOAD_MB` | 50 | Download size cap |
| `CACHE_TTL_SECONDS` | 60 | Search cache TTL in KV |
| `UPSTREAM_TIMEOUT_MS` | 10000 | Upstream + body timeout |
| `RATE_LIMIT_SEARCH` / `RATE_LIMIT_MEDIA` | 30 / 60 | Requests per window |
| `RATE_LIMIT_WINDOW_SEC` | 60 | Rate-limit window |
| `UPSTREAM_ALLOWLIST` / `CDN_ALLOWLIST` | see file | Host allowlists |

### Mobile note
The Git-connected repo may not appear in the mobile dashboard editor — use the **Deploy button**, the **GitHub Action**, or **wrangler**.

---

## فارسی

### روش الف — کپی در داشبورد (ساده‌ترین)
1. `npm install && npm run bundle` → فایل تک‌جایی `dist/worker.js` ساخته می‌شود.
2. داشبورد کلادفلر → Workers & Pages → Create Worker → محتوای `dist/worker.js` را در ویرایشگر بچسبانید → Deploy.
3. یک KV بسازید (Workers & Pages → KV → Create) با نام `CACHE_KV`.
4. آن را Bind کنید: Worker → Settings → Bindings → KV Namespaces → نام متغیر `CACHE_KV`.
5. (اختیاری) Secretها را اضافه کنید: `SOUNDCLOUD_CLIENT_ID`، `JAMENDO_CLIENT_ID`، `API_KEYS`.

### روش ب — wrangler CLI
همان دستورات بالا.

### روش ج — GitHub Action
دو Secret `CLOUDFLARE_API_TOKEN` (با مجوز Workers Scripts + KV Edit) و `CLOUDFLARE_ACCOUNT_ID` را تنظیم کنید و workflow را دستی اجرا کنید.

### نکتهٔ موبایل
مخزن متصل به Git ممکن است در ویرایشگر موبایل دیده نشود — از دکمهٔ Deploy، Action یا wrangler استفاده کنید.
