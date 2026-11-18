import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Stripe from "stripe";
import type { ProductInput } from "../src/lib/catalog-admin.ts";
import { FakeStripe } from "./fake-stripe.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "Set DATABASE_URL to the isolated cartiva_test database.");
assert.equal(new URL(databaseUrl).pathname, "/cartiva_test", "Order integration tests may run only against cartiva_test.");
assert.ok(process.env.BETTER_AUTH_URL, "Set BETTER_AUTH_URL for handler requests.");
const origin = new URL(process.env.BETTER_AUTH_URL).origin;
const webhookSecret = `whsec_test_${randomUUID().replaceAll("-", "")}`;
process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

test("checkout holds stock, Stripe confirmation places the order once, and expiry releases holds", { timeout: 120_000 }, async t => {
  const { auth } = await import("../src/server/auth.ts");
  const { pool } = await import("../src/server/db.ts");
  const { POST: startRoute } = await import("../src/app/api/checkout/route.ts");
  const { POST: quoteRoute } = await import("../src/app/api/checkout/quote/route.ts");
  const { GET: statusRoute } = await import("../src/app/api/checkout/status/route.ts");
  const { POST: webhookRoute } = await import("../src/app/api/webhooks/stripe/route.ts");
  const { saveCatalogProduct, loadPublishedCatalog, CatalogError } = await import("../src/server/catalog.ts");
  const orders = await import("../src/server/orders.ts");
  const { setPaymentGatewayForTests } = await import("../src/server/payment-gateway.ts");
  const stripe = new FakeStripe();
  setPaymentGatewayForTests(stripe);

  const runId = randomUUID();
  const tag = runId.slice(0, 8).toUpperCase();
  const password = `Test-only-${randomUUID()}`;
  const userIds: string[] = [];
  const productIds: string[] = [];
  const buyerEmail = (label: string) => `orders-${runId}-${label}@example.test`;
  let eventCount = 0;

  function request(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
    return new Request(`${origin}${path}`, {
      method: init.method ?? "GET",
      headers: { origin, ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }
  async function user(label: string, role?: string) {
    const response = await auth.handler(request("/api/auth/sign-up/email", { method: "POST", body: { name: `Orders ${label}`, email: buyerEmail(`user-${label}`), password } }));
    assert.equal(response.status, 200);
    const { user: created } = await response.json() as { user: { id: string } };
    userIds.push(created.id);
    if (role) await pool.query("UPDATE \"user\" SET role = $1 WHERE id = $2", [role, created.id]);
    return { id: created.id, cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") };
  }
  function checkoutBody(lines: { variantId: string; quantity: number }[], overrides: Record<string, unknown> = {}) {
    return { checkoutKey: randomUUID(), email: buyerEmail("guest"), name: "QA Buyer", address: "1 Test Way", city: "Austin", state: "TX", zip: "78701", shippingMethodId: "standard", couponCode: null, lines, ...overrides };
  }
  /** Starts a checkout; like the browser, it confirms the total the server quoted unless the test sets one. */
  async function start(body: Record<string, unknown>, cookie?: string, headers?: Record<string, string>) {
    let payload = body;
    if (!("expectedTotalCents" in body)) {
      const quote = await quoteRoute(request("/api/checkout/quote", { method: "POST", body: { lines: body.lines, state: body.state, couponCode: body.couponCode ?? null, shippingMethodId: body.shippingMethodId ?? null } }));
      payload = { ...body, expectedTotalCents: quote.ok ? (await quote.json() as { totalCents: number }).totalCents : 0 };
    }
    const response = await startRoute(request("/api/checkout", { method: "POST", body: payload, cookie, headers }));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  async function balance(variantId: string) {
    const { rows } = await pool.query("SELECT on_hand, reserved FROM inventory_balance WHERE variant_id = $1", [variantId]);
    return { onHand: rows[0].on_hand as number, reserved: rows[0].reserved as number };
  }
  async function order(number: string) {
    const { rows } = await pool.query("SELECT * FROM customer_order WHERE number = $1", [number]);
    return rows[0];
  }
  function sessionOf(url: unknown) {
    return String(url).split("/").pop()!;
  }
  async function webhook(type: string, sessionId: string, options: { id?: string; signature?: string } = {}) {
    const id = options.id ?? `evt_${tag}_${++eventCount}`;
    const payload = JSON.stringify({ id, object: "event", type, api_version: "2026-10-28.endive", created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null }, data: { object: { id: sessionId, object: "checkout.session" } } });
    const signature = options.signature ?? Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const response = await webhookRoute(new Request(`${origin}/api/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body: payload }));
    return { status: response.status, body: await response.json() as Record<string, unknown>, id };
  }
  async function count(sql: string, values: unknown[]) {
    const { rows } = await pool.query(sql, values);
    return Number(rows[0].count);
  }
  function product(name: string, variants: { size: string; price: number; stock: number }[]): ProductInput {
    return {
      version: 0, status: "published", name: `${name} ${tag}`, description: "A temporary QA product for order tests.", details: ["QA"],
      category: "Home & living", vendor: "QA Goods", optionNames: ["Size"], swatches: {},
      media: [{ id: "editorial-room", src: "/images/editorial-room.jpg", alt: "A quiet, sunlit contemporary living room.", label: "Living room" }],
      variants: variants.map(variant => ({ options: [variant.size], sku: `QA-${tag}-${name.slice(0, 3).toUpperCase()}-${variant.size}`, price: variant.price, compareAtPrice: null, stock: variant.stock, expectedStock: null, mediaIds: ["editorial-room"] })),
    };
  }

  try {
    await pool.query("DELETE FROM rate_limit");
    const admin = await user("admin", "administrator");
    const customer = await user("customer");
    const other = await user("other");
    const vase = await saveCatalogProduct(admin.id, undefined, product("Vase", [{ size: "S", price: 4000, stock: 3 }, { size: "L", price: 12000, stock: 1 }]));
    const lamp = await saveCatalogProduct(admin.id, undefined, product("Lamp", [{ size: "One", price: 9000, stock: 1 }]));
    const draft = await saveCatalogProduct(admin.id, undefined, { ...product("Draft", [{ size: "One", price: 5000, stock: 5 }]), status: "draft" });
    productIds.push(vase.id, lamp.id, draft.id);
    const [small, large] = vase.variants;
    const [lampUnit] = lamp.variants;
    let firstOrder = "";
    let firstKey = "";
    let raceWinner: Record<string, unknown> = {};

    await t.test("only valid same-origin checkouts of published stock are accepted", async () => {
      assert.equal((await start(checkoutBody([{ variantId: small.id, quantity: 1 }]), undefined, { origin: "https://evil.example" })).status, 403);
      const invalid = await start(checkoutBody([{ variantId: small.id, quantity: 1 }], { zip: "ABCDE", price: 1 }));
      assert.equal(invalid.status, 400);
      const zip = await start(checkoutBody([{ variantId: small.id, quantity: 1 }], { zip: "ABCDE" }));
      assert.equal(zip.status, 400);
      assert.ok((zip.body.fieldErrors as Record<string, string>).zip);
      const hidden = await start(checkoutBody([{ variantId: draft.variants[0].id, quantity: 1 }]));
      assert.equal(hidden.status, 409);
      assert.equal((hidden.body.problems as { reason: string }[])[0].reason, "unavailable");
      assert.equal(stripe.creates, 0);
    });

    await t.test("prices come from the database, stock is held, and repeated clicks resume one order", async () => {
      const body = checkoutBody([{ variantId: small.id, quantity: 2 }, { variantId: large.id, quantity: 1 }]);
      firstKey = body.checkoutKey;
      const first = await start(body);
      assert.equal(first.status, 200);
      assert.equal(first.body.kind, "redirect");
      firstOrder = String(first.body.number);
      const row = await order(firstOrder);
      assert.equal(row.subtotal_cents, 2 * 4000 + 12000);
      assert.equal(row.shipping_cents, 0, "orders of $150 or more ship free");
      assert.equal(row.total_cents, 20000);
      assert.equal(row.status, "pending_payment");
      assert.deepEqual(await balance(small.id), { onHand: 3, reserved: 2 });
      assert.deepEqual(await balance(large.id), { onHand: 1, reserved: 1 });
      const storefront = (await loadPublishedCatalog()).find(item => item.id === vase.id)!;
      assert.equal(storefront.variants.find(variant => variant.id === small.id)!.stock, 1);
      assert.equal(storefront.variants.find(variant => variant.id === large.id)!.stock, 0);

      const creates = stripe.creates;
      const again = await Promise.all([start(body), start(body), start(body)]);
      for (const response of again) {
        assert.equal(response.status, 200);
        assert.equal(response.body.number, firstOrder);
        assert.equal(response.body.url, first.body.url);
      }
      assert.equal(stripe.creates, creates, "a stored session is resumed without calling Stripe again");
      assert.equal(await count("SELECT count(*) FROM customer_order WHERE request_hash = $1", [row.request_hash]), 1);
      assert.deepEqual(await balance(small.id), { onHand: 3, reserved: 2 });
    });

    await t.test("a sold-out item is refused without leaving an order or a hold behind", async () => {
      const before = await count("SELECT count(*) FROM customer_order WHERE email = $1", [buyerEmail("guest")]);
      const refused = await start(checkoutBody([{ variantId: large.id, quantity: 1 }]));
      assert.equal(refused.status, 409);
      assert.deepEqual(refused.body.problems, [{ variantId: large.id, reason: "insufficient", available: 0, name: `Vase ${tag}` }]);
      assert.equal(await count("SELECT count(*) FROM customer_order WHERE email = $1", [buyerEmail("guest")]), before);
      assert.deepEqual(await balance(large.id), { onHand: 1, reserved: 1 });
    });

    await t.test("two buyers racing for the last unit get exactly one hold", async () => {
      const results = await Promise.all([1, 2, 3].map(() => start(checkoutBody([{ variantId: lampUnit.id, quantity: 1 }]))));
      assert.deepEqual(results.map(result => result.status).sort(), [200, 409, 409]);
      assert.deepEqual(await balance(lampUnit.id), { onHand: 1, reserved: 1 });
      raceWinner = results.find(result => result.status === 200)!.body;
    });

    await t.test("Stripe's expiry event releases that hold and frees the checkout key", async () => {
      const session = sessionOf(raceWinner.url);
      await stripe.expireCheckout(session);
      const expired = await webhook("checkout.session.expired", session);
      assert.equal(expired.body.outcome, "processed");
      const row = await order(String(raceWinner.number));
      assert.equal(row.status, "canceled");
      assert.equal(row.payment_status, "expired");
      assert.equal(row.checkout_key, null);
      assert.deepEqual(await balance(lampUnit.id), { onHand: 1, reserved: 0 });
    });

    await t.test("a changed bag replaces the earlier attempt and releases what it no longer needs", async () => {
      const replaced = await start(checkoutBody([{ variantId: small.id, quantity: 1 }], { checkoutKey: firstKey }));
      assert.equal(replaced.status, 200);
      assert.notEqual(replaced.body.number, firstOrder);
      const old = await order(firstOrder);
      assert.equal(old.status, "canceled");
      assert.equal(old.payment_status, "expired");
      assert.equal(old.checkout_key, null);
      assert.equal(stripe.sessions.get(old.stripe_checkout_session_id)!.status, "expired", "the old payment page can no longer be paid");
      assert.deepEqual(await balance(small.id), { onHand: 3, reserved: 1 });
      assert.deepEqual(await balance(large.id), { onHand: 1, reserved: 0 });
      firstOrder = String(replaced.body.number);
    });

    await t.test("signed webhooks place the order exactly once with stock, ledger and outbox", async () => {
      const row = await order(firstOrder);
      const session = row.stripe_checkout_session_id as string;
      assert.equal((await webhook("checkout.session.completed", session, { signature: "t=1,v1=bad" })).status, 400);
      const unsigned = await webhookRoute(new Request(`${origin}/api/webhooks/stripe`, { method: "POST", body: "{}" }));
      assert.equal(unsigned.status, 400);
      assert.equal((await order(firstOrder)).status, "pending_payment");

      stripe.pay(session);
      const delivered = await webhook("checkout.session.completed", session);
      assert.equal(delivered.status, 200);
      assert.equal(delivered.body.outcome, "processed");
      const placed = await order(firstOrder);
      assert.equal(placed.status, "placed");
      assert.equal(placed.payment_status, "paid");
      assert.equal(placed.fulfillment_status, "unfulfilled");
      assert.equal(placed.review_reason, null);
      assert.ok(placed.stripe_payment_intent_id);
      assert.deepEqual(await balance(small.id), { onHand: 2, reserved: 0 });

      const replay = await webhook("checkout.session.completed", session, { id: delivered.id });
      assert.equal(replay.body.outcome, "duplicate");
      const second = await webhook("checkout.session.completed", session);
      assert.equal(second.status, 200, "a distinct delivery of the same payment is harmless");
      assert.deepEqual(await balance(small.id), { onHand: 2, reserved: 0 });
      assert.equal(await count("SELECT count(*) FROM stock_movement WHERE order_id = $1 AND reason = 'sale'", [placed.id]), 1);
      assert.equal(await count("SELECT count(*) FROM outbox_event WHERE aggregate_id = $1 AND topic = 'order.placed'", [placed.id]), 1);
      const journals = await pool.query("SELECT j.kind, sum(l.debit_cents)::int AS debits, sum(l.credit_cents)::int AS credits FROM ledger_journal j JOIN ledger_line l ON l.journal_id = j.id WHERE j.order_id = $1 GROUP BY j.kind ORDER BY j.kind", [placed.id]);
      assert.deepEqual(journals.rows.map(journal => journal.kind), ["order_payment", "payment_fee"]);
      for (const journal of journals.rows) assert.equal(journal.debits, journal.credits, `${journal.kind} balances`);
      assert.equal(journals.rows[0].debits, placed.total_cents);
      const stored = await pool.query("SELECT processed_at, attempts FROM webhook_event WHERE id = $1", [delivered.id]);
      assert.ok(stored.rows[0].processed_at);
      assert.equal(stored.rows[0].attempts, 2);
    });

    await t.test("the confirmation page checks with Stripe when the webhook is late", async () => {
      const started = await start(checkoutBody([{ variantId: small.id, quantity: 1 }], { email: buyerEmail("signed-in") }), customer.cookie);
      assert.equal(started.status, 200);
      const session = sessionOf(started.body.url);
      const waiting = await statusRoute(request(`/api/checkout/status?session_id=${session}`));
      assert.equal((await waiting.json() as { paymentStatus: string }).paymentStatus, "awaiting");
      stripe.pay(session);
      const confirmed = await statusRoute(request(`/api/checkout/status?session_id=${session}`));
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.headers.get("cache-control"), "private, no-store");
      const body = await confirmed.json() as { paymentStatus: string; status: string; number: string; lines: unknown[] };
      assert.equal(body.paymentStatus, "paid");
      assert.equal(body.status, "placed");
      assert.equal(body.lines.length, 1);
      assert.equal((await webhook("checkout.session.completed", session)).status, 200);
      assert.deepEqual(await balance(small.id), { onHand: 1, reserved: 0 });
      assert.equal((await statusRoute(request("/api/checkout/status?session_id=nope"))).status, 404);
      assert.equal((await statusRoute(request(`/api/checkout/status?session_id=cs_test_${"x".repeat(20)}`))).status, 404);

      const mine = await orders.listCustomerOrders(customer.id);
      assert.deepEqual(mine.map(item => item.number), [body.number]);
      assert.equal((await orders.getCustomerOrder(customer.id, body.number))?.totalCents, 4000 + 900);
      assert.equal(await orders.getCustomerOrder(other.id, body.number), null);
      assert.equal((await orders.listCustomerOrders(other.id)).length, 0);
      assert.equal(await orders.getCustomerOrder(customer.id, firstOrder), null, "guest orders are not linked to an account");
    });

    await t.test("the sweeper expires stale checkouts at Stripe before releasing stock", async () => {
      const stale = await start(checkoutBody([{ variantId: lampUnit.id, quantity: 1 }]));
      const paidLate = await start(checkoutBody([{ variantId: small.id, quantity: 1 }]));
      assert.equal(stale.status, 200);
      assert.equal(paidLate.status, 200);
      stripe.pay(sessionOf(paidLate.body.url));
      await pool.query("UPDATE customer_order SET reservation_expires_at = now() - interval '10 minutes' WHERE number = ANY($1)", [[stale.body.number, paidLate.body.number]]);
      assert.equal(await orders.releaseExpiredReservations(), 1);
      assert.equal((await order(String(stale.body.number))).status, "canceled");
      assert.equal(stripe.sessions.get(sessionOf(stale.body.url))!.status, "expired");
      assert.deepEqual(await balance(lampUnit.id), { onHand: 1, reserved: 0 });
      assert.equal((await order(String(paidLate.body.number))).status, "placed", "a paid checkout is placed, never released");
      assert.deepEqual(await balance(small.id), { onHand: 0, reserved: 0 });
    });

    await t.test("a payment service failure cancels the attempt and releases the hold", async () => {
      stripe.failNextCreate = true;
      const failed = await start(checkoutBody([{ variantId: lampUnit.id, quantity: 1 }]));
      assert.equal(failed.status, 502);
      assert.match(String(failed.body.error), /Nothing was charged/);
      assert.deepEqual(await balance(lampUnit.id), { onHand: 1, reserved: 0 });
    });

    await t.test("on hand cannot drop below stock held by open checkouts", async () => {
      const held = await start(checkoutBody([{ variantId: lampUnit.id, quantity: 1 }]));
      assert.equal(held.status, 200);
      const current = (await (await import("../src/server/catalog.ts")).listAdminProducts()).find(item => item.id === lamp.id)!;
      await assert.rejects(saveCatalogProduct(admin.id, lamp.id, {
        ...product("Lamp", [{ size: "One", price: 9000, stock: 0 }]), name: current.name, version: current.version,
        variants: current.variants.map(variant => ({ id: variant.id, options: variant.options, sku: variant.sku, price: variant.price, compareAtPrice: variant.compareAtPrice, stock: 0, expectedStock: variant.stock, mediaIds: variant.mediaIds })),
      }), (error: unknown) => error instanceof CatalogError && error.status === 409 && Boolean(error.fieldErrors?.["variants.0.stock"]));
      await stripe.expireCheckout(sessionOf(held.body.url));
      await webhook("checkout.session.expired", sessionOf(held.body.url));
      assert.equal((await order(String(held.body.number))).status, "canceled");
      assert.deepEqual(await balance(lampUnit.id), { onHand: 1, reserved: 0 });
    });

    await t.test("a payment that arrives after cancellation is placed and flagged for review", async () => {
      const late = await start(checkoutBody([{ variantId: lampUnit.id, quantity: 1 }]));
      const session = sessionOf(late.body.url);
      const row = await order(String(late.body.number));
      // Simulate a local cancellation that raced the customer's payment.
      await pool.query("UPDATE inventory_balance SET reserved = reserved - 1 WHERE variant_id = $1", [lampUnit.id]);
      await pool.query("UPDATE customer_order SET status = 'canceled', payment_status = 'expired', checkout_key = NULL WHERE id = $1", [row.id]);
      stripe.pay(session);
      await webhook("checkout.session.completed", session);
      const placed = await order(String(late.body.number));
      assert.equal(placed.status, "placed");
      assert.match(placed.review_reason, /after this checkout had been canceled/);
      assert.deepEqual(await balance(lampUnit.id), { onHand: 0, reserved: 0 }, "the unit was still free, so it was taken");
    });

    await t.test("every journal posted by these orders balances", async () => {
      const unbalanced = await pool.query(`SELECT j.id FROM ledger_journal j JOIN ledger_line l ON l.journal_id = j.id
        JOIN customer_order o ON o.id = j.order_id WHERE o.email LIKE $1 GROUP BY j.id HAVING sum(l.debit_cents) <> sum(l.credit_cents)`, [`orders-${runId}-%`]);
      assert.equal(unbalanced.rowCount, 0);
    });
  } finally {
    setPaymentGatewayForTests(null);
    const run = `orders-${runId}-%`;
    await pool.query("DELETE FROM ledger_journal WHERE order_id IN (SELECT id FROM customer_order WHERE email LIKE $1)", [run]);
    await pool.query("DELETE FROM outbox_event WHERE aggregate_id IN (SELECT id FROM customer_order WHERE email LIKE $1)", [run]);
    await pool.query("DELETE FROM audit_event WHERE subject_id IN (SELECT id FROM customer_order WHERE email LIKE $1) OR subject_id = ANY($2)", [run, productIds]);
    await pool.query("DELETE FROM customer_order WHERE email LIKE $1", [run]);
    await pool.query("DELETE FROM webhook_event WHERE id LIKE $1", [`evt_${tag}_%`]);
    if (productIds.length) await pool.query("DELETE FROM catalog_product WHERE id = ANY($1)", [productIds]);
    if (userIds.length) await pool.query("DELETE FROM \"user\" WHERE id = ANY($1)", [userIds]);
    await pool.end();
  }
});
