import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Stripe from "stripe";
import type { ProductInput } from "../src/lib/catalog-admin.ts";
import { defaultShippingConfig, type CouponInput, type ShippingConfig } from "../src/lib/checkout-settings.ts";
import { FakeStripe } from "./fake-stripe.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "Set DATABASE_URL to the isolated cartiva_test database.");
assert.equal(new URL(databaseUrl).pathname, "/cartiva_test", "Checkout settings tests may run only against cartiva_test.");
assert.ok(process.env.BETTER_AUTH_URL, "Set BETTER_AUTH_URL for handler requests.");
const origin = new URL(process.env.BETTER_AUTH_URL).origin;
const webhookSecret = `whsec_test_${randomUUID().replaceAll("-", "")}`;
process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

test("shipping zones, pickup, discount codes and guest lookup are enforced on the server", { timeout: 120_000 }, async t => {
  const { auth } = await import("../src/server/auth.ts");
  const { pool } = await import("../src/server/db.ts");
  const { POST: startRoute } = await import("../src/app/api/checkout/route.ts");
  const { POST: quoteRoute } = await import("../src/app/api/checkout/quote/route.ts");
  const { POST: lookupRoute } = await import("../src/app/api/orders/lookup/route.ts");
  const { POST: webhookRoute } = await import("../src/app/api/webhooks/stripe/route.ts");
  const shippingRoute = await import("../src/app/api/admin/shipping/route.ts");
  const couponsRoute = await import("../src/app/api/admin/coupons/route.ts");
  const couponRoute = await import("../src/app/api/admin/coupons/[id]/route.ts");
  const { saveCatalogProduct } = await import("../src/server/catalog.ts");
  const { saveCoupon } = await import("../src/server/checkout-settings.ts");
  const { setPaymentGatewayForTests } = await import("../src/server/payment-gateway.ts");
  const stripe = new FakeStripe();
  setPaymentGatewayForTests(stripe);

  const runId = randomUUID();
  const tag = runId.slice(0, 6).toUpperCase();
  const password = `Test-only-${randomUUID()}`;
  const userIds: string[] = [];
  const productIds: string[] = [];
  const couponCodes: string[] = [];
  const email = (label: string) => `settings-${runId}-${label}@example.test`;
  const saved = await pool.query("SELECT value, version FROM store_setting WHERE key = 'shipping'");
  let eventCount = 0;

  function request(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
    return new Request(`${origin}${path}`, {
      method: init.method ?? "GET",
      headers: { origin, ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }
  async function json(response: Response) {
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  async function user(label: string, role?: string) {
    const response = await auth.handler(request("/api/auth/sign-up/email", { method: "POST", body: { name: `Settings ${label}`, email: email(`user-${label}`), password } }));
    assert.equal(response.status, 200);
    const { user: created } = await response.json() as { user: { id: string } };
    userIds.push(created.id);
    if (role) await pool.query("UPDATE \"user\" SET role = $1 WHERE id = $2", [role, created.id]);
    return { id: created.id, cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") };
  }
  const quote = async (body: Record<string, unknown>) => json(await quoteRoute(request("/api/checkout/quote", { method: "POST", body })));
  function checkoutBody(lines: { variantId: string; quantity: number }[], overrides: Record<string, unknown> = {}) {
    return { checkoutKey: randomUUID(), email: email("buyer"), name: "QA Buyer", address: "1 Test Way", city: "Austin", state: "TX", zip: "78701", shippingMethodId: "standard", couponCode: null, lines, ...overrides };
  }
  async function start(body: Record<string, unknown>) {
    let payload = body;
    if (!("expectedTotalCents" in body)) {
      const quoted = await quote({ lines: body.lines, state: body.state, couponCode: body.couponCode, shippingMethodId: body.shippingMethodId });
      payload = { ...body, expectedTotalCents: quoted.status === 200 ? quoted.body.totalCents : 0 };
    }
    return json(await startRoute(request("/api/checkout", { method: "POST", body: payload })));
  }
  const sessionOf = (url: unknown) => String(url).split("/").pop()!;
  async function order(number: unknown) {
    return (await pool.query("SELECT * FROM customer_order WHERE number = $1", [number])).rows[0];
  }
  async function couponRow(code: string) {
    return (await pool.query("SELECT * FROM coupon WHERE code = $1", [code])).rows[0];
  }
  async function paidByWebhook(sessionId: string) {
    stripe.pay(sessionId);
    const payload = JSON.stringify({ id: `evt_${tag}_${++eventCount}`, object: "event", type: "checkout.session.completed", api_version: "2026-10-28.endive", created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null }, data: { object: { id: sessionId, object: "checkout.session" } } });
    const response = await webhookRoute(new Request(`${origin}/api/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret }) }, body: payload }));
    assert.equal(response.status, 200);
  }
  function coupon(code: string, overrides: Partial<CouponInput> = {}): CouponInput {
    couponCodes.push(code);
    return { version: 0, code, kind: "percent", percentOff: 10, amountOffCents: null, minSubtotalCents: 0, startsAt: null, endsAt: null, usageLimit: null, active: true, ...overrides };
  }

  try {
    await pool.query("DELETE FROM rate_limit");
    await pool.query("UPDATE store_setting SET value = $1 WHERE key = 'shipping'", [JSON.stringify(defaultShippingConfig)]);
    const customer = await user("customer");
    const staff = await user("staff", "staff");
    const manager = await user("manager", "manager");
    const product: ProductInput = {
      version: 0, status: "published", name: `QA Tray ${tag}`, description: "A temporary QA product for checkout settings tests.", details: ["QA"],
      category: "Home & living", vendor: "QA Goods", optionNames: ["Size"], swatches: {},
      media: [{ id: "editorial-room", src: "/images/editorial-room.jpg", alt: "A quiet, sunlit contemporary living room.", label: "Living room" }],
      variants: [{ options: ["One"], sku: `QA-${tag}-TRAY`, price: 5000, compareAtPrice: null, stock: 20, expectedStock: null, mediaIds: ["editorial-room"] }],
    };
    const tray = await saveCatalogProduct(manager.id, undefined, product);
    productIds.push(tray.id);
    const variantId = tray.variants[0].id;
    const two = [{ variantId, quantity: 2 }];
    let pickupNumber = "";

    await t.test("only checkout managers can read or change shipping and codes, from Cartiva only", async () => {
      assert.equal((await shippingRoute.GET(request("/api/admin/shipping"))).status, 401);
      assert.equal((await shippingRoute.GET(request("/api/admin/shipping", { cookie: customer.cookie }))).status, 403);
      assert.equal((await shippingRoute.GET(request("/api/admin/shipping", { cookie: staff.cookie }))).status, 403);
      assert.equal((await couponsRoute.GET(request("/api/admin/coupons", { cookie: staff.cookie }))).status, 403);
      const listed = await json(await shippingRoute.GET(request("/api/admin/shipping", { cookie: manager.cookie })));
      assert.equal(listed.status, 200);
      const hostile = await shippingRoute.PUT(request("/api/admin/shipping", { method: "PUT", cookie: manager.cookie, headers: { origin: "https://evil.example" }, body: { version: listed.body.version, config: defaultShippingConfig } }));
      assert.equal(hostile.status, 403);
      assert.equal((await couponsRoute.POST(request("/api/admin/coupons", { method: "POST", cookie: customer.cookie, body: coupon(`NOPE${tag}`) }))).status, 403);
    });

    await t.test("delivery options follow the state, thresholds and pickup eligibility", async () => {
      const texas = await quote({ lines: two, state: "TX" });
      assert.deepEqual((texas.body.methods as { id: string; priceCents: number }[]).map(method => [method.id, method.priceCents]), [["standard", 900], ["express", 2400]]);
      assert.deepEqual([texas.body.selectedMethodId, texas.body.shippingCents, texas.body.totalCents], ["standard", 900, 10900]);
      const york = await quote({ lines: two, state: "NY", shippingMethodId: "studio-pickup" });
      assert.deepEqual((york.body.methods as { id: string }[]).map(method => method.id), ["standard", "express", "studio-pickup"]);
      assert.deepEqual([york.body.selectedMethodId, york.body.shippingCents, york.body.totalCents], ["studio-pickup", 0, 10000]);
      const free = await quote({ lines: [{ variantId, quantity: 3 }], state: "CA" });
      assert.equal(free.body.shippingCents, 0, "$150 of merchandise ships free");
      const hawaii = await quote({ lines: two, state: "HI", shippingMethodId: "standard" });
      assert.deepEqual([hawaii.body.selectedMethodId, hawaii.body.shippingCents], ["standard-remote", 1900], "an unavailable choice falls back to the state's first option");
    });

    await t.test("shipping settings are versioned, validated and used by the next quote", async () => {
      const current = await json(await shippingRoute.GET(request("/api/admin/shipping", { cookie: manager.cookie })));
      const version = current.body.version as number;
      const overlapping: ShippingConfig = { ...defaultShippingConfig, zones: [defaultShippingConfig.zones[0], { ...defaultShippingConfig.zones[1], states: ["AK", "TX"] }] };
      const invalid = await json(await shippingRoute.PUT(request("/api/admin/shipping", { method: "PUT", cookie: manager.cookie, body: { version, config: overlapping } })));
      assert.equal(invalid.status, 400);
      assert.ok(Object.keys(invalid.body.fieldErrors as object).some(key => key.startsWith("config.zones.1.states")));
      const withoutRemote: ShippingConfig = { ...defaultShippingConfig, zones: [defaultShippingConfig.zones[0]] };
      const savedChange = await json(await shippingRoute.PUT(request("/api/admin/shipping", { method: "PUT", cookie: manager.cookie, body: { version, config: withoutRemote } })));
      assert.equal(savedChange.status, 200);
      assert.equal(savedChange.body.version, version + 1);
      const stale = await shippingRoute.PUT(request("/api/admin/shipping", { method: "PUT", cookie: manager.cookie, body: { version, config: defaultShippingConfig } }));
      assert.equal(stale.status, 409);
      const alaska = await quote({ lines: two, state: "AK" });
      assert.deepEqual(alaska.body.methods, []);
      assert.match(String(alaska.body.shippingMessage), /don't deliver to AK/);
      const refused = await start(checkoutBody(two, { state: "AK", shippingMethodId: "standard-remote", expectedTotalCents: 10000 }));
      assert.equal(refused.status, 409);
      assert.equal(refused.body.code, "shipping");
      const restored = await json(await shippingRoute.PUT(request("/api/admin/shipping", { method: "PUT", cookie: manager.cookie, body: { version: version + 1, config: defaultShippingConfig } })));
      assert.equal(restored.status, 200);
    });

    await t.test("codes are managed with versions, unique names and honest limits", async () => {
      const created = await json(await couponsRoute.POST(request("/api/admin/coupons", { method: "POST", cookie: manager.cookie, body: coupon(`SAVE${tag}`, { code: `save${tag}` }) })));
      assert.equal(created.status, 201);
      assert.equal(created.body.code, `SAVE${tag}`, "codes are stored in upper case");
      assert.equal(created.body.state, "live");
      const duplicate = await json(await couponsRoute.POST(request("/api/admin/coupons", { method: "POST", cookie: manager.cookie, body: coupon(`SAVE${tag}`) })));
      assert.equal(duplicate.status, 409);
      assert.ok((duplicate.body.fieldErrors as Record<string, string>).code);
      const id = created.body.id as string;
      const edited = await json(await couponRoute.PUT(request(`/api/admin/coupons/${id}`, { method: "PUT", cookie: manager.cookie, body: coupon(`SAVE${tag}`, { version: 1, percentOff: 20 }) }), { params: Promise.resolve({ id }) }));
      assert.equal(edited.status, 200);
      assert.equal(edited.body.percentOff, 20);
      const stale = await couponRoute.PUT(request(`/api/admin/coupons/${id}`, { method: "PUT", cookie: manager.cookie, body: coupon(`SAVE${tag}`, { version: 1 }) }), { params: Promise.resolve({ id }) });
      assert.equal(stale.status, 409);
      const invalid = await couponsRoute.POST(request("/api/admin/coupons", { method: "POST", cookie: manager.cookie, body: coupon(`BAD${tag}`, { kind: "fixed" }) }));
      assert.equal(invalid.status, 400);
    });

    await t.test("a percentage code discounts the order, reaches Stripe and is booked as a sales discount", async () => {
      const preview = await quote({ lines: two, state: "TX", couponCode: `save${tag}` });
      assert.deepEqual(preview.body.coupon, { code: `SAVE${tag}`, ok: true, message: "20% off applied." });
      assert.deepEqual([preview.body.subtotalCents, preview.body.discountCents, preview.body.shippingCents, preview.body.totalCents], [10000, 2000, 900, 8900]);
      const started = await start(checkoutBody(two, { couponCode: `SAVE${tag}` }));
      assert.equal(started.status, 200);
      const row = await order(started.body.number);
      assert.deepEqual([row.subtotal_cents, row.discount_cents, row.shipping_cents, row.total_cents, row.coupon_code], [10000, 2000, 900, 8900, `SAVE${tag}`]);
      assert.equal(row.shipping_method.id, "standard");
      assert.match(row.stripe_coupon_id, /^coupon_/, "the provider's coupon is kept for reconciliation");
      const sent = stripe.request(sessionOf(started.body.url));
      assert.deepEqual(sent.discount, { code: `SAVE${tag}`, amountCents: 2000 });
      assert.equal(stripe.total(sent), 8900, "Stripe charges exactly the Cartiva total");
      assert.equal((await couponRow(`SAVE${tag}`)).used_count, 1, "an open checkout holds one use");
      await paidByWebhook(sessionOf(started.body.url));
      const placed = await order(started.body.number);
      assert.equal(placed.status, "placed");
      assert.equal(placed.review_reason, null);
      assert.equal((await pool.query("SELECT status FROM coupon_redemption WHERE order_id = $1", [placed.id])).rows[0].status, "redeemed");
      const lines = await pool.query("SELECT l.account, l.debit_cents, l.credit_cents FROM ledger_line l JOIN ledger_journal j ON j.id = l.journal_id WHERE j.order_id = $1 AND j.kind = 'order_payment' ORDER BY l.account::text", [placed.id]);
      assert.deepEqual(lines.rows.map(line => [line.account, line.debit_cents, line.credit_cents]), [
        ["sales_discounts", 2000, 0], ["sales_revenue", 0, 10000], ["shipping_revenue", 0, 900], ["stripe_receivable", 8900, 0],
      ]);
    });

    await t.test("free delivery, minimums and dates are applied by the server, not the browser", async () => {
      await saveCoupon(manager.id, undefined, coupon(`SHIP${tag}`, { kind: "free_shipping", percentOff: null }));
      const express = await quote({ lines: two, state: "TX", couponCode: `SHIP${tag}`, shippingMethodId: "express" });
      assert.deepEqual([express.body.discountCents, express.body.shippingCents, express.body.totalCents], [0, 0, 10000]);
      await saveCoupon(manager.id, undefined, coupon(`BIG${tag}`, { kind: "fixed", percentOff: null, amountOffCents: 2500, minSubtotalCents: 20000 }));
      const short = await quote({ lines: two, state: "TX", couponCode: `BIG${tag}` });
      assert.equal((short.body.coupon as { ok: boolean }).ok, false);
      assert.match((short.body.coupon as { message: string }).message, /Add \$100\.00 more/);
      assert.equal(short.body.discountCents, 0, "a refused code changes nothing");
      const forced = await start(checkoutBody(two, { couponCode: `BIG${tag}`, expectedTotalCents: 7500 }));
      assert.equal(forced.status, 409);
      assert.equal(forced.body.code, "coupon");
      await saveCoupon(manager.id, undefined, coupon(`LATER${tag}`, { startsAt: new Date(Date.now() + 86_400_000).toISOString() }));
      assert.match(((await quote({ lines: two, state: "TX", couponCode: `LATER${tag}` })).body.coupon as { message: string }).message, /isn't active yet/);
      assert.match(((await quote({ lines: two, state: "TX", couponCode: `MISSING${tag}` })).body.coupon as { message: string }).message, /isn't valid/);
    });

    await t.test("a changed total is refused until the shopper has seen it", async () => {
      const stale = await start(checkoutBody(two, { expectedTotalCents: 10000 }));
      assert.equal(stale.status, 409);
      assert.equal(stale.body.code, "total_changed");
      assert.equal((stale.body.totals as { totalCents: number }).totalCents, 10900);
      assert.match(String(stale.body.error), /\$109\.00/);
      const pickupElsewhere = await start(checkoutBody(two, { shippingMethodId: "studio-pickup", expectedTotalCents: 10000 }));
      assert.equal(pickupElsewhere.status, 409);
      assert.equal(pickupElsewhere.body.code, "shipping", "pickup is only for NY, NJ and CT");
    });

    await t.test("a limited code can't be oversold by concurrent checkouts, and expiry gives the use back", async () => {
      await saveCoupon(manager.id, undefined, coupon(`ONCE${tag}`, { usageLimit: 1 }));
      const results = await Promise.all([1, 2, 3].map(() => start(checkoutBody([{ variantId, quantity: 1 }], { couponCode: `ONCE${tag}` }))));
      const statuses = results.map(result => result.status).sort();
      assert.deepEqual(statuses, [200, 409, 409]);
      assert.ok(results.filter(result => result.status === 409).every(result => result.body.code === "coupon"));
      assert.equal((await couponRow(`ONCE${tag}`)).used_count, 1);
      const winner = results.find(result => result.status === 200)!;
      await stripe.expireCheckout(sessionOf(winner.body.url));
      const payload = JSON.stringify({ id: `evt_${tag}_${++eventCount}`, object: "event", type: "checkout.session.expired", api_version: "2026-10-28.endive", created: 1, livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null }, data: { object: { id: sessionOf(winner.body.url), object: "checkout.session" } } });
      await webhookRoute(new Request(`${origin}/api/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret }) }, body: payload }));
      assert.equal((await couponRow(`ONCE${tag}`)).used_count, 0, "the canceled checkout released its use");
      assert.equal((await pool.query("SELECT r.status FROM coupon_redemption r JOIN customer_order o ON o.id = r.order_id WHERE o.number = $1", [winner.body.number])).rows[0].status, "released");
      const again = await start(checkoutBody([{ variantId, quantity: 1 }], { couponCode: `ONCE${tag}` }));
      assert.equal(again.status, 200);
    });

    await t.test("pickup orders carry the pickup point to Stripe and the order", async () => {
      const started = await start(checkoutBody(two, { state: "NY", city: "Brooklyn", zip: "11201", shippingMethodId: "studio-pickup" }));
      assert.equal(started.status, 200);
      const row = await order(started.body.number);
      assert.deepEqual([row.shipping_cents, row.total_cents, row.shipping_method.kind, row.shipping_method.address], [0, 10000, "pickup", "Cartiva studio, Brooklyn, NY"]);
      assert.equal(stripe.request(sessionOf(started.body.url)).shipping.name, "Pickup at the Cartiva studio");
      await paidByWebhook(sessionOf(started.body.url));
      assert.equal((await order(started.body.number)).status, "placed");
      pickupNumber = String(started.body.number);
    });

    await t.test("guests find placed orders only by exact number and email, within a request budget", async () => {
      const placed = { number: pickupNumber, email: email("buyer") };
      const found = await json(await lookupRoute(request("/api/orders/lookup", { method: "POST", body: { number: placed.number.toLowerCase(), email: placed.email.toUpperCase() } })));
      assert.equal(found.status, 200);
      assert.equal(found.body.number, placed.number);
      assert.equal(found.body.destination, "Pickup at the Cartiva studio");
      assert.equal("email" in found.body, false);
      assert.equal(JSON.stringify(found.body).includes("1 Test Way"), false, "the street address is never returned");
      const wrongEmail = await json(await lookupRoute(request("/api/orders/lookup", { method: "POST", body: { number: placed.number, email: email("someone-else") } })));
      const wrongNumber = await json(await lookupRoute(request("/api/orders/lookup", { method: "POST", body: { number: "CV-999999999", email: placed.email } })));
      assert.deepEqual([wrongEmail.status, wrongNumber.status], [404, 404]);
      assert.equal(wrongEmail.body.error, wrongNumber.body.error, "the reply never says which part was wrong");
      const pending = (await pool.query("SELECT number FROM customer_order WHERE email = $1 AND status = 'pending_payment' LIMIT 1", [email("buyer")])).rows[0];
      assert.equal((await lookupRoute(request("/api/orders/lookup", { method: "POST", body: { number: pending.number, email: email("buyer") } }))).status, 404, "unpaid checkouts are not orders yet");
      assert.equal((await lookupRoute(request("/api/orders/lookup", { method: "POST", headers: { origin: "https://evil.example" }, body: { number: placed.number, email: placed.email } }))).status, 403);
      await pool.query("UPDATE rate_limit SET count = 30, last_request = $1 WHERE key = 'cartiva:order-lookup'", [Date.now()]);
      assert.equal((await lookupRoute(request("/api/orders/lookup", { method: "POST", body: { number: placed.number, email: placed.email } }))).status, 429);
    });
  } finally {
    setPaymentGatewayForTests(null);
    const run = `settings-${runId}-%`;
    await pool.query("DELETE FROM ledger_journal WHERE order_id IN (SELECT id FROM customer_order WHERE email LIKE $1)", [run]);
    await pool.query("DELETE FROM outbox_event WHERE aggregate_id IN (SELECT id FROM customer_order WHERE email LIKE $1)", [run]);
    await pool.query("DELETE FROM audit_event WHERE subject_id IN (SELECT id FROM customer_order WHERE email LIKE $1) OR subject_id IN (SELECT id FROM coupon WHERE code = ANY($2)) OR subject_id = ANY($3)", [run, couponCodes, productIds]);
    await pool.query("DELETE FROM customer_order WHERE email LIKE $1", [run]);
    await pool.query("DELETE FROM coupon WHERE code = ANY($1)", [couponCodes]);
    await pool.query("DELETE FROM webhook_event WHERE id LIKE $1", [`evt_${tag}_%`]);
    await pool.query("DELETE FROM rate_limit WHERE key = 'cartiva:order-lookup'");
    if (saved.rowCount) await pool.query("UPDATE store_setting SET value = $1 WHERE key = 'shipping'", [JSON.stringify(saved.rows[0].value)]);
    if (productIds.length) await pool.query("DELETE FROM catalog_product WHERE id = ANY($1)", [productIds]);
    if (userIds.length) await pool.query("DELETE FROM \"user\" WHERE id = ANY($1)", [userIds]);
    await pool.query("DELETE FROM audit_event WHERE subject_id = 'shipping' AND actor_id = ANY($1)", [userIds]);
    await pool.end();
  }
});
