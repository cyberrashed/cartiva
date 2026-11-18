import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { productInputSchema, productToInput } from "../lib/catalog-admin";
import { defaultShippingConfig } from "../lib/checkout-settings";
import type { OrderDTO } from "../lib/checkout";
import { sampleProducts } from "../lib/sample-catalog";
import { auth } from "./auth";
import { seedCatalogProduct } from "./catalog";
import { db, pool } from "./db";
import { account, coupon, user } from "./schema";

/**
 * Public portfolio mode. Visitors sign in to shared demo accounts with one click;
 * the password lives only in the DEMO_PASSWORD environment variable.
 */
export function demoMode() {
  return process.env.DEMO_MODE === "true";
}

export const demoAccounts = {
  shopper: { email: "demo.shopper@example.com", name: "Demo Shopper", role: "customer", landing: "/account" },
  admin: { email: "demo.admin@example.com", name: "Demo Admin", role: "administrator", landing: "/admin/orders" },
} as const;
export type DemoRole = keyof typeof demoAccounts;

function demoPassword() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 16 || password.length > 128) throw new Error("DEMO_PASSWORD must be 16–128 characters.");
  return password;
}

/** Creates the demo accounts, or brings their role and password back in line. Idempotent. */
export async function ensureDemoAccounts(): Promise<string[]> {
  const password = demoPassword();
  const context = await auth.$context;
  const done: string[] = [];
  for (const demo of Object.values(demoAccounts)) {
    let [existing] = await db.select().from(user).where(eq(user.email, demo.email)).limit(1);
    if (!existing) {
      await auth.api.signUpEmail({ body: { name: demo.name, email: demo.email, password } });
      [existing] = await db.select().from(user).where(eq(user.email, demo.email)).limit(1);
    } else {
      // Rotating DEMO_PASSWORD takes effect on the next deploy.
      await db.update(account).set({ password: await context.password.hash(password), updatedAt: new Date() })
        .where(and(eq(account.userId, existing.id), eq(account.providerId, "credential")));
    }
    await db.update(user).set({ role: demo.role, updatedAt: new Date() }).where(eq(user.id, existing.id));
    done.push(demo.email);
  }
  return done;
}

export function signInDemo(role: DemoRole, headers: Headers) {
  return auth.api.signInEmail({ body: { email: demoAccounts[role].email, password: demoPassword() }, headers, asResponse: true });
}

export function isDemoAccount(email: string) {
  return Object.values(demoAccounts).some(demo => demo.email === email);
}

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain ?? ""}`;
}

/**
 * In the public demo, anyone can open the shared admin and shopper accounts, so
 * visitor-entered contact details are hidden from those views.
 */
export function redactOrderForDemo<T extends Pick<OrderDTO, "email" | "shipping">>(order: T): T {
  const [first, ...rest] = order.shipping.name.trim().split(/\s+/);
  return {
    ...order,
    email: maskEmail(order.email),
    shipping: { ...order.shipping, name: rest.length ? `${first} ${rest[rest.length - 1].slice(0, 1)}.` : first, address: "Street hidden in the public demo" },
  };
}

const demoCoupons = [
  { code: "WELCOME15", kind: "percent" as const, percentOff: 15, amountOffCents: null, minSubtotalCents: 5000 },
  { code: "FREESHIP", kind: "free_shipping" as const, percentOff: null, amountOffCents: null, minSubtotalCents: 0 },
];

/** Adds the demo codes if they are missing; never changes existing ones. */
export async function seedDemoCoupons() {
  for (const demo of demoCoupons) {
    await db.insert(coupon).values({ id: randomUUID(), ...demo, startsAt: null, endsAt: null, usageLimit: null, active: true })
      .onConflictDoNothing({ target: coupon.code });
  }
}

/**
 * Daily reset for the public demo: removes day-old orders (and the personal data
 * visitors typed into them), restores the sample catalog, stock, shipping settings
 * and demo codes. Open checkouts are left alone so nobody's payment breaks mid-way.
 */
export async function resetDemoStore() {
  const client = await pool.connect();
  const summary = { ordersRemoved: 0, productsRestored: 0, productsArchived: 0, stockAdjusted: 0 };
  try {
    await client.query("BEGIN");
    const old = await client.query<{ id: string }>(
      "SELECT id FROM customer_order WHERE created_at < now() - interval '24 hours' AND status <> 'pending_payment'",
    );
    const ids = old.rows.map(row => row.id);
    if (ids.length) {
      await client.query("DELETE FROM ledger_journal WHERE order_id = ANY($1)", [ids]);
      await client.query("DELETE FROM outbox_event WHERE aggregate_id = ANY($1)", [ids]);
      await client.query("DELETE FROM audit_event WHERE subject_id = ANY($1)", [ids]);
      await client.query("DELETE FROM customer_order WHERE id = ANY($1)", [ids]);
      summary.ordersRemoved = ids.length;
    }
    const sampleIds = sampleProducts.map(product => product.id);
    for (const [position, product] of sampleProducts.entries()) {
      const input = productInputSchema.parse(productToInput(product));
      const exists = await client.query("SELECT 1 FROM catalog_product WHERE id = $1 FOR UPDATE", [product.id]);
      if (!exists.rowCount) continue; // re-created below, outside this transaction
      await client.query(
        `UPDATE catalog_product SET name = $2, category = $3, vendor_name = $4, description = $5, details = $6, option_names = $7,
           swatches = $8, media = $9, status = 'published', position = $10, version = version + 1, updated_at = now(),
           published_at = COALESCE(published_at, now()) WHERE id = $1`,
        [product.id, input.name, input.category, input.vendor, input.description, JSON.stringify(input.details), JSON.stringify(input.optionNames),
          JSON.stringify(input.swatches), JSON.stringify(input.media), position],
      );
      const variantIds = input.variants.map(variant => variant.id!);
      await client.query("UPDATE catalog_variant SET archived = true, updated_at = now() WHERE product_id = $1 AND NOT (id = ANY($2))", [product.id, variantIds]);
      for (const [index, variant] of input.variants.entries()) {
        // Free the sample SKU if a visitor gave it to another variant.
        await client.query("UPDATE catalog_variant SET sku = sku || '-' || left(id, 6) WHERE sku = $1 AND id <> $2", [variant.sku, variant.id]);
        const options = Object.fromEntries(input.optionNames.map((name, at) => [name, variant.options[at]]));
        await client.query(
          `UPDATE catalog_variant SET sku = $2, options = $3, price_cents = $4, compare_at_cents = $5, media_ids = $6, position = $7,
             archived = false, updated_at = now() WHERE id = $1`,
          [variant.id, variant.sku, JSON.stringify(options), variant.price, variant.compareAtPrice, JSON.stringify(variant.mediaIds), index],
        );
        const balance = await client.query<{ on_hand: number; reserved: number }>("SELECT on_hand, reserved FROM inventory_balance WHERE variant_id = $1 FOR UPDATE", [variant.id]);
        const current = balance.rows[0];
        if (!current) continue;
        const target = Math.max(variant.stock, current.reserved);
        if (target !== current.on_hand) {
          await client.query("UPDATE inventory_balance SET on_hand = $2, updated_at = now() WHERE variant_id = $1", [variant.id, target]);
          await client.query("INSERT INTO stock_movement (id, variant_id, delta, balance_after, reason, actor_id) VALUES ($1, $2, $3, $4, 'adjustment', NULL)",
            [randomUUID(), variant.id, target - current.on_hand, target]);
          summary.stockAdjusted++;
        }
      }
      summary.productsRestored++;
    }
    const archived = await client.query("UPDATE catalog_product SET status = 'archived', version = version + 1, updated_at = now() WHERE NOT (id = ANY($1)) AND status <> 'archived'", [sampleIds]);
    summary.productsArchived = archived.rowCount ?? 0;
    await client.query(
      `INSERT INTO store_setting (key, value, version, updated_by, updated_at) VALUES ('shipping', $1, 1, NULL, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = store_setting.version + 1, updated_by = NULL, updated_at = now()`,
      [JSON.stringify(defaultShippingConfig)],
    );
    // Uses count only what still exists after day-old orders were removed.
    await client.query(`UPDATE coupon c SET used_count = (SELECT count(*) FROM coupon_redemption r WHERE r.coupon_id = c.id AND r.status IN ('held', 'redeemed'))`);
    await client.query(`UPDATE coupon SET active = false, version = version + 1, updated_at = now() WHERE NOT (code = ANY($1)) AND active`, [demoCoupons.map(item => item.code)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  for (const [position, product] of sampleProducts.entries()) {
    const input = productInputSchema.parse(productToInput(product));
    if (await seedCatalogProduct({ ...input, id: product.id, slug: product.slug, position })) summary.productsRestored++;
  }
  for (const demo of demoCoupons) {
    const values = { ...demo, startsAt: null, endsAt: null, usageLimit: null, active: true, updatedAt: new Date() };
    const [existing] = await db.select({ id: coupon.id, version: coupon.version }).from(coupon).where(eq(coupon.code, demo.code)).limit(1);
    if (existing) await db.update(coupon).set({ ...values, version: existing.version + 1 }).where(eq(coupon.id, existing.id));
    else await db.insert(coupon).values({ id: randomUUID(), ...values });
  }
  return summary;
}
