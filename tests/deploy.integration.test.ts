import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "Set DATABASE_URL to the isolated cartiva_test database.");
assert.equal(new URL(databaseUrl).pathname, "/cartiva_test", "Deploy tests may run only against cartiva_test.");
assert.ok(process.env.BETTER_AUTH_URL, "Set BETTER_AUTH_URL for handler requests.");
const origin = new URL(process.env.BETTER_AUTH_URL).origin;
const cronSecret = `cron-${randomUUID()}`;
process.env.CRON_SECRET = cronSecret;
process.env.DEMO_PASSWORD = `demo-${randomUUID()}`;

test("public demo sign-in, the daily job and the demo reset are guarded and restore the sample store", { timeout: 120_000 }, async t => {
  const { auth } = await import("../src/server/auth.ts");
  const { pool } = await import("../src/server/db.ts");
  const { POST: demoSession } = await import("../src/app/api/demo/session/route.ts");
  const { GET: daily } = await import("../src/app/api/cron/daily/route.ts");
  const demo = await import("../src/server/demo.ts");
  const { sampleProducts } = await import("../src/lib/sample-catalog.ts");
  const runId = randomUUID();
  const visitorProduct = `visitor-${runId}`;
  const orderIds: string[] = [];

  function form(role: string, headers: Record<string, string> = {}) {
    const body = new URLSearchParams({ role });
    return new Request(`${origin}/api/demo/session`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded", ...headers }, body });
  }
  const cron = (authorization?: string) => daily(new Request(`${origin}/api/cron/daily`, { headers: authorization ? { authorization } : {} }));

  try {
    await pool.query("DELETE FROM rate_limit");
    await t.test("demo sign-in exists only in demo mode, from Cartiva, for known roles", async () => {
      delete process.env.DEMO_MODE;
      assert.equal((await demoSession(form("shopper"))).status, 404);
      process.env.DEMO_MODE = "true";
      assert.deepEqual(await demo.ensureDemoAccounts(), ["demo.shopper@example.com", "demo.admin@example.com"]);
      assert.deepEqual(await demo.ensureDemoAccounts(), ["demo.shopper@example.com", "demo.admin@example.com"], "running it again is harmless");
      assert.equal((await demoSession(form("shopper", { origin: "https://evil.example" }))).status, 403);
      assert.equal((await demoSession(form("owner"))).status, 400);
    });

    await t.test("a demo sign-in sets a session for that account and lands on its page", async () => {
      for (const [role, landing, expectedRole] of [["shopper", "/account", "customer"], ["admin", "/admin/orders", "administrator"]] as const) {
        const response = await demoSession(form(role));
        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), `${origin}${landing}`);
        const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
        assert.ok(cookie.includes("session_token"));
        const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
        assert.equal(session?.user.email, demo.demoAccounts[role].email);
        assert.equal(session?.user.role, expectedRole);
      }
      const rotated = process.env.DEMO_PASSWORD;
      process.env.DEMO_PASSWORD = `wrong-${randomUUID()}`;
      const failed = await demoSession(form("shopper"));
      assert.equal(failed.status, 303);
      assert.equal(failed.headers.get("location"), `${origin}/demo?unavailable=1`);
      assert.equal(failed.headers.getSetCookie().length, 0);
      process.env.DEMO_PASSWORD = rotated;
    });

    await t.test("shared demo views hide visitor contact details", () => {
      const order = { email: "alex.morgan@example.com", shipping: { name: "Alex James Morgan", address: "12 Real Street", city: "Austin", state: "TX", zip: "78701", country: "US" as const } };
      const hidden = demo.redactOrderForDemo(order);
      assert.equal(hidden.email, "a•••@example.com");
      assert.equal(hidden.shipping.name, "Alex M.");
      assert.equal(hidden.shipping.address, "Street hidden in the public demo");
      assert.equal(hidden.shipping.city, "Austin");
    });

    await t.test("the daily job requires the cron secret", async () => {
      assert.equal((await cron()).status, 401);
      assert.equal((await cron("Bearer wrong")).status, 401);
      assert.equal((await cron(`Bearer ${cronSecret}x`)).status, 401);
    });

    await t.test("the demo reset restores the sample store and removes day-old orders", async () => {
      const mug = sampleProducts.find(product => product.id === "ritual-ceramic-mug") ?? sampleProducts[0];
      const [first, second] = mug.variants;
      // A visitor's changes over the day:
      await pool.query("UPDATE catalog_variant SET price_cents = 1, sku = 'VISITOR-SKU' WHERE id = $1", [first.id]);
      if (second) await pool.query("UPDATE catalog_variant SET archived = true WHERE id = $1", [second.id]);
      await pool.query("UPDATE inventory_balance SET on_hand = 999 WHERE variant_id = $1", [first.id]);
      await pool.query("UPDATE catalog_product SET name = 'Vandalized', status = 'draft' WHERE id = $1", [mug.id]);
      await pool.query(`INSERT INTO catalog_product (id, slug, name, category, vendor_name, description, details, option_names, swatches, media, status)
        VALUES ($1, $1, 'Visitor product', 'Tech', 'Visitor', 'Made by a visitor', '[]', '["Size"]', '{}', '[]', 'published')`, [visitorProduct]);
      await pool.query("UPDATE store_setting SET value = $1 WHERE key = 'shipping'", [JSON.stringify({ zones: [], pickups: [] })]);
      await pool.query(`INSERT INTO coupon (id, code, kind, percent_off, active) VALUES ($1, $2, 'percent', 90, true)`, [randomUUID(), `VISITOR${runId.slice(0, 6).toUpperCase()}`]);
      for (const age of ["2 days", "1 hour"]) {
        const id = randomUUID();
        orderIds.push(id);
        await pool.query(`INSERT INTO customer_order (id, number, request_hash, email, shipping, status, payment_status, subtotal_cents, shipping_cents, tax_cents, total_cents, reservation_expires_at, created_at)
          VALUES ($1, $2, 'x', 'visitor@example.test', $3, 'placed', 'paid', 1000, 0, 0, 1000, now(), now() - $4::interval)`,
          [id, `CV-9${Math.floor(Math.random() * 1e8)}`, JSON.stringify({ name: "V", address: "1 St", city: "A", state: "TX", zip: "78701", country: "US" }), age]);
      }

      const response = await cron(`Bearer ${cronSecret}`);
      assert.equal(response.status, 200);
      const body = await response.json() as { demo: { ordersRemoved: number; productsArchived: number } };
      assert.ok(body.demo.ordersRemoved >= 1);
      assert.ok(body.demo.productsArchived >= 1);

      const restored = (await pool.query("SELECT name, status FROM catalog_product WHERE id = $1", [mug.id])).rows[0];
      assert.deepEqual(restored, { name: mug.name, status: "published" });
      const variant = (await pool.query("SELECT v.price_cents, v.sku, v.archived, b.on_hand FROM catalog_variant v JOIN inventory_balance b ON b.variant_id = v.id WHERE v.id = $1", [first.id])).rows[0];
      assert.deepEqual(variant, { price_cents: first.price, sku: first.sku, archived: false, on_hand: first.stock });
      if (second) assert.equal((await pool.query("SELECT archived FROM catalog_variant WHERE id = $1", [second.id])).rows[0].archived, false);
      assert.equal((await pool.query("SELECT status FROM catalog_product WHERE id = $1", [visitorProduct])).rows[0].status, "archived");
      const shipping = (await pool.query("SELECT value FROM store_setting WHERE key = 'shipping'")).rows[0].value as { zones: unknown[] };
      assert.ok(shipping.zones.length >= 2, "default shipping settings are back");
      const codes = (await pool.query("SELECT code, active FROM coupon ORDER BY code")).rows as { code: string; active: boolean }[];
      assert.ok(codes.find(code => code.code === "WELCOME15")?.active);
      assert.ok(codes.find(code => code.code === "FREESHIP")?.active);
      assert.equal(codes.find(code => code.code.startsWith("VISITOR"))?.active, false);
      const remaining = (await pool.query("SELECT id FROM customer_order WHERE id = ANY($1)", [orderIds])).rows.map(row => row.id);
      assert.deepEqual(remaining, [orderIds[1]], "only the day-old order was removed");
    });
  } finally {
    delete process.env.DEMO_MODE;
    await pool.query("DELETE FROM customer_order WHERE id = ANY($1)", [orderIds]);
    await pool.query("DELETE FROM stock_movement WHERE variant_id IN (SELECT id FROM catalog_variant WHERE product_id = $1)", [visitorProduct]);
    await pool.query("DELETE FROM catalog_product WHERE id = $1", [visitorProduct]);
    await pool.query("DELETE FROM coupon WHERE code IN ('WELCOME15', 'FREESHIP') OR code LIKE 'VISITOR%'");
    await pool.query("DELETE FROM audit_event WHERE actor_id IN (SELECT id FROM \"user\" WHERE email LIKE 'demo.%@example.com')");
    await pool.query("DELETE FROM \"user\" WHERE email IN ('demo.shopper@example.com', 'demo.admin@example.com')");
    await pool.end();
  }
});
