# Local setup, accounts and access

Cartiva stores users, hashed credentials and sessions in PostgreSQL. Public registration always creates a customer; every operations page checks the signed-in user's role on the server.

## First setup

Run these from the project folder (PowerShell on Windows shown; use `npm` instead of `npm.cmd` elsewhere). You need Node 22.18+ and Docker Desktop with its Linux engine running. Install dependencies with `npm.cmd ci`.

```powershell
npm.cmd run setup:local
npm.cmd run db:up
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run db:owner
npm.cmd run build
npm.cmd run start -- --hostname 127.0.0.1 --port 3000
```

- **`setup:local`** generates random database and authentication secrets in `.env.local` and `.env.test.local`. It keeps existing files instead of rotating their credentials. `.env.example` lists the variable names with placeholders only. Real environment files and the `.local` folder are excluded from version control.
- **The database:** PostgreSQL listens only on `127.0.0.1:55432`. The image is pinned by digest in [compose.yaml](../compose.yaml), and data lives in the named volume `cartiva_postgres_data`. Stopping the container keeps the data; don't remove the volume to troubleshoot.
- **`db:migrate`** applies the checked-in migrations in `drizzle/`. Use `db:generate` only when changing the schema, and review the generated SQL.
- **`db:seed`** adds the eight sample products and the default shipping settings. It matches products by ID and never overwrites admin edits. The storefront is prerendered from the catalog, so `build` needs the database running and seeded.

## Owner access

`db:owner` creates a local owner account with a generated password and writes the sign-in details to `.local/owner-access.txt` (never committed). It accepts only the loopback `cartiva` database. If an owner already exists, nothing changes; it is not a password-recovery tool. This preview owner must not become a deployed default account. Deployed demos use the shared demo accounts described in [DEPLOY.md](DEPLOY.md).

## Restarting

```powershell
npm.cmd run db:up
npm.cmd run start -- --hostname 127.0.0.1 --port 3000
```

`start` serves the last build, so rebuild after source changes. For development use `npm.cmd run dev -- --hostname 127.0.0.1`. `http://127.0.0.1:3000` and `http://localhost:3000` both work, but the browser keeps a separate sign-in for each, so stay on one (`npm run dev` prints 127.0.0.1). Another port does not work: sign-in and API requests are only accepted from the address in `BETTER_AUTH_URL` and the other local names for its port.

## Access model

| Role | Store overview | Orders | Shipping & codes | Products | Content | Seller applications | Seller workspace | POS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Administrator | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | Yes | Yes | No | No | Yes |
| Staff | No | No | No | No | No | No | No | Yes |
| Vendor owner / vendor staff | No | No | No | No | No | No | Yes | No |
| Customer | No | Own placed orders in `/account` | No | No | No | No | Own approved store only | No |

Anyone can look up a placed order at `/track-order` with its number and checkout email.

Customers apply to sell at `/become-vendor/apply`. Approval by an owner or administrator creates the applicant's store and changes a `customer` role to `vendor_owner`; staff and admin roles are never overwritten. Reviewers cannot decide their own application.

Guests are sent to sign in before protected pages; signed-in users without the permission get an access-denied page. Unknown roles are denied, and public input can never set a role. This is a fixed role matrix, not a permission-management system.

## Persistent data and sample screens

- Accounts, sessions, seller applications, products, variants, stock and stock movements are in PostgreSQL.
- Orders, discount codes, shipping settings, the ledger, the outbox and webhook receipts are also in PostgreSQL.
- Cart and favorites stay in the browser and are not synced to the account.
- `/account/sample`, the store overview charts and the seller earnings screen use clearly labeled sample data. POS sales do not deduct stock. The content editor saves to browser storage and does not publish to the storefront.

## Integration tests

The integration suites run against a separate `cartiva_test` database and refuse any other database name. Create it once after the container is healthy:

```powershell
docker compose --env-file .env.local exec -T postgres createdb -U cartiva cartiva_test
npm.cmd run db:migrate:test
npm.cmd run db:seed:test
```

| Suite | What it covers |
| --- | --- |
| `test:identity` | Password hashing, customer defaults, sessions and cookies, user separation, role-escalation attempts, hostile origins, logout replay, expiry, throttling |
| `test:seller` | Application ownership, draft/submit validation, version conflicts, review permission, self-review rejection, atomic approval |
| `test:catalog` | `catalog:manage`, draft/publish/archive, stock movements, stale-stock and version conflicts, concurrent saves, SKU uniqueness |
| `test:orders` | Server pricing, stock holds, idempotent and concurrent checkouts, the last-unit race, signed and replayed webhooks, late confirmation, the expiry sweeper, payment-service failure, balanced journals |
| `test:checkout-settings` | Shipping options per state, settings validation, discount codes (exact Stripe amount, limits under concurrency, release on expiry), pickup, guest order lookup |
| `test:deploy` | Demo sign-in, the cron secret, hidden visitor details, the daily demo reset |

Stripe is replaced by a recorded fake (`tests/fake-stripe.ts`), so no network or keys are needed. Each suite creates and removes its own users, products and orders; don't run two suites at the same time against the same database. Pure unit tests run with `npm.cmd test`.

If `.env.test.local` is missing, copy `.env.local` to it and change only the database name in `DATABASE_URL` to `cartiva_test`.

## Known limits

- Email verification and password recovery are not connected yet, and the sign-up API still reveals whether an email is registered.
- Sessions expire after seven days and are checked against the database on every request. Sign-out revokes the current session.
- **Rate limits** (10 sign-ins and 5 sign-ups per minute, 100 requests overall): on a direct local connection, forwarded IP headers are ignored, so they use one shared bucket per path. On Vercel they use the platform's trusted client IP.
