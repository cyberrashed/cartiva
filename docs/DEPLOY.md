# Deploying Cartiva as a public portfolio demo

Target: **Vercel** (hosting, cron) + **Neon** (PostgreSQL, free tier) + **Stripe sandbox**. Deploys go straight from this folder with the Vercel CLI; no git repository is needed. Payments stay in Stripe's sandbox: the server refuses any key that is not `sk_test_…`.

## What the demo mode adds (`DEMO_MODE=true`)

- A thin banner on every store page linking to `/demo`.
- `/demo` signs visitors in with one click to a shared **Demo Shopper** (customer) or **Demo Admin** (administrator). The shared password exists only in `DEMO_PASSWORD`; it never reaches the browser.
- **Visitor contact details are hidden in shared views.** In the admin and on the demo shopper's orders, emails are masked, names shortened and street addresses hidden. Checkout asks visitors to use made-up details.
- **A daily job** (`/api/cron/daily`, Vercel Cron at 08:00 UTC, protected by `CRON_SECRET`):
  - releases expired stock holds;
  - deletes orders older than a day (and the details visitors typed into them);
  - restores the sample catalog, stock, shipping settings and the demo codes `WELCOME15` (15% off from $50) and `FREESHIP`;
  - deactivates other codes and archives visitor-created products.

  Open checkouts are left alone.
- **Rate limits are per visitor on Vercel**: sign-in, sign-up and order lookup use the IP from Vercel's trusted headers. They are shared buckets when run locally.

## 1. Generate the secrets (once)

```powershell
npm.cmd run deploy:secrets
```

This writes `.local/production-secrets.env` (ignored, never uploaded) with `BETTER_AUTH_SECRET`, `DEMO_PASSWORD`, `CRON_SECRET` and `DEMO_MODE=true`. Nothing is printed. Open the file to copy the values.

## 2. Create the database (Neon)

1. Sign up at neon.tech (the Free plan needs no card) and create a project with **Postgres 17** in **AWS US East 1 (N. Virginia)**. That is next to Vercel's default function region (`iad1`, Washington, D.C.), so each database query stays within the same area.
2. On the project dashboard, open **Connect**, turn on **Connection pooling**, and copy the connection string. Its host contains `-pooler`, and it ends with `?sslmode=require`.

This value is `DATABASE_URL`. Migrations and the sample data are applied automatically by every production build (`npm run build:deploy`), so there is nothing to run by hand.

## 3. Create the Vercel project and add settings

```powershell
npm install -g vercel
vercel login
vercel link
```

`vercel link` creates a project from this folder (accept the defaults; the framework is detected as Next.js). Then, in the Vercel dashboard → the project → **Settings → Environment Variables**, add these for the **Production** environment only:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection string |
| `BETTER_AUTH_SECRET` | from `.local/production-secrets.env` |
| `BETTER_AUTH_URL` | `https://<your-project>.vercel.app` (see step 4) |
| `STRIPE_SECRET_KEY` | your `sk_test_…` key (same as `.env.local`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | your `pk_test_…` key |
| `STRIPE_WEBHOOK_SECRET` | added in step 5 |
| `DEMO_MODE` | `true` |
| `DEMO_PASSWORD` | from `.local/production-secrets.env` |
| `CRON_SECRET` | from `.local/production-secrets.env` |

Keep Preview deployments without these values. Every build migrates the database it is given, so previews must never point at the production database.

## 4. First deploy

```powershell
vercel deploy --prod
```

The build migrates and seeds the database, creates the demo accounts and codes, and prerenders the store. The output ends with the production URL (`https://<your-project>.vercel.app`).

**If `BETTER_AUTH_URL` doesn't match the URL in the output:** set it to exactly that origin (`https://…`, no trailing slash) and run `vercel deploy --prod` again. Sign-in, checkout and the Stripe return links all use it.

## 5. Stripe webhook (recommended)

In the Stripe Dashboard (sandbox), open **Developers → Webhooks** (also shown as **Workbench → Event destinations**). Add an endpoint:

- **URL:** `https://<your-project>.vercel.app/api/webhooks/stripe`
- **Events:** `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`

Copy its **signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` and deploy again. Without it, payments are still confirmed when the shopper reaches the confirmation page, but an abandoned page won't be confirmed until the daily job.

Optional: in Stripe **Settings → Business → Public details**, set the business name to *Cartiva*. The payment page shows that name.

## 6. Check the live demo

- `/demo` → **Enter as the store admin** lands on Orders; **Enter as a shopper** lands on the account.
- Buy something with `4242 4242 4242 4242`, try `WELCOME15`, and see the order in the account and in the admin (contact details hidden).
- Vercel → the project → **Settings → Cron Jobs** lists `/api/cron/daily`. **Run** it once; it returns `{ "released": …, "demo": { … } }`.

## Updating

Run `vercel deploy --prod` from this folder after changes. Migrations in `drizzle/` apply automatically during the build; saved products, settings and orders are kept (except what the daily demo reset restores).

## Not included

- A custom domain (add one in Vercel → Domains, then update `BETTER_AUTH_URL` and the Stripe endpoint).
- Email delivery (order emails stay in the outbox table).
- Search indexing: the demo is `noindex` on purpose.
- Live Stripe keys: refused by design.
