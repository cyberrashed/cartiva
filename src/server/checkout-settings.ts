import "server-only";
import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import {
  defaultShippingConfig, shippingConfigSchema,
  type CouponInput, type CouponRule, type ShippingConfig,
} from "../lib/checkout-settings";
import { db } from "./db";
import { isUniqueViolation } from "./db-errors";
import { auditEvent, coupon, storeSetting } from "./schema";

export class SettingsError extends Error {
  constructor(public status: number, message: string, public fieldErrors?: Record<string, string>) {
    super(message);
  }
}

type Executor = Pick<typeof db, "select" | "insert" | "update">;
const SHIPPING_KEY = "shipping";

export type ShippingSettings = { version: number; config: ShippingConfig; updatedAt: string | null };

/** Saved shipping settings, or the defaults (version 0) before anyone has saved them. */
export async function loadShippingSettings(executor: Executor = db): Promise<ShippingSettings> {
  const [row] = await executor.select().from(storeSetting).where(eq(storeSetting.key, SHIPPING_KEY)).limit(1);
  if (!row) return { version: 0, config: defaultShippingConfig, updatedAt: null };
  return { version: row.version, config: shippingConfigSchema.parse(row.value), updatedAt: row.updatedAt.toISOString() };
}

/** Callers must enforce checkout:manage first. `version` guards against overwriting another edit. */
export async function saveShippingSettings(actorId: string, version: number, config: ShippingConfig): Promise<ShippingSettings> {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(storeSetting).where(eq(storeSetting.key, SHIPPING_KEY)).for("update");
    const current = row?.version ?? 0;
    if (current !== version) throw new SettingsError(409, "Shipping settings changed since you opened them. Reload to see the latest.");
    const now = new Date();
    const [saved] = row
      ? await tx.update(storeSetting).set({ value: config, version: current + 1, updatedBy: actorId, updatedAt: now })
        .where(eq(storeSetting.key, SHIPPING_KEY)).returning()
      : await tx.insert(storeSetting).values({ key: SHIPPING_KEY, value: config, version: 1, updatedBy: actorId, updatedAt: now }).returning();
    await tx.insert(auditEvent).values({ id: randomUUID(), actorId, action: "shipping_settings.updated", subjectId: SHIPPING_KEY });
    return { version: saved.version, config, updatedAt: saved.updatedAt.toISOString() };
  });
}

/** Seeds the default shipping settings once; never overwrites saved ones. */
export async function seedShippingSettings(): Promise<boolean> {
  const inserted = await db.insert(storeSetting).values({ key: SHIPPING_KEY, value: defaultShippingConfig, version: 1 })
    .onConflictDoNothing().returning({ key: storeSetting.key });
  return inserted.length > 0;
}

export type CouponState = "live" | "scheduled" | "ended" | "used_up" | "off";
export type AdminCoupon = CouponInput & { id: string; state: CouponState; usedCount: number; redeemedCount: number; heldCount: number; createdAt: string; updatedAt: string };
type CouponRow = typeof coupon.$inferSelect;

function couponState(row: CouponRow, now: Date): CouponState {
  if (!row.active) return "off";
  if (row.startsAt && row.startsAt > now) return "scheduled";
  if (row.endsAt && row.endsAt <= now) return "ended";
  if (row.usageLimit !== null && row.usedCount >= row.usageLimit) return "used_up";
  return "live";
}

export function couponRule(row: CouponRow): CouponRule {
  return {
    code: row.code, kind: row.kind, percentOff: row.percentOff, amountOffCents: row.amountOffCents,
    minSubtotalCents: row.minSubtotalCents, startsAt: row.startsAt, endsAt: row.endsAt,
    usageLimit: row.usageLimit, usedCount: row.usedCount, active: row.active,
  };
}

function adminCoupon(row: CouponRow, counts: { redeemed: number; held: number } = { redeemed: 0, held: 0 }): AdminCoupon {
  return {
    id: row.id, version: row.version, code: row.code, kind: row.kind, percentOff: row.percentOff, amountOffCents: row.amountOffCents,
    minSubtotalCents: row.minSubtotalCents, startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null,
    usageLimit: row.usageLimit, active: row.active, state: couponState(row, new Date()),
    usedCount: row.usedCount, redeemedCount: counts.redeemed, heldCount: counts.held,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

// Callers must enforce checkout:manage first.
export async function listCoupons(): Promise<AdminCoupon[]> {
  const rows = await db.select().from(coupon).orderBy(asc(coupon.code));
  const counts = await db.execute<{ coupon_id: string; status: string; count: string }>(
    sql`SELECT coupon_id, status::text AS status, count(*)::text AS count FROM coupon_redemption GROUP BY coupon_id, status`,
  );
  const byCoupon = new Map<string, { redeemed: number; held: number }>();
  for (const row of counts.rows) {
    const entry = byCoupon.get(row.coupon_id) ?? { redeemed: 0, held: 0 };
    if (row.status === "redeemed") entry.redeemed = Number(row.count);
    if (row.status === "held") entry.held = Number(row.count);
    byCoupon.set(row.coupon_id, entry);
  }
  return rows.map(row => adminCoupon(row, byCoupon.get(row.id)));
}

/** Creates (`couponId` undefined) or updates a code. Callers must enforce checkout:manage first. */
export async function saveCoupon(actorId: string, couponId: string | undefined, input: CouponInput): Promise<AdminCoupon> {
  const values = {
    code: input.code, kind: input.kind, percentOff: input.percentOff, amountOffCents: input.amountOffCents,
    minSubtotalCents: input.minSubtotalCents, startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null, usageLimit: input.usageLimit, active: input.active,
  };
  try {
    return await db.transaction(async tx => {
      const now = new Date();
      let row: CouponRow;
      if (!couponId) {
        if (input.version !== 0) throw new SettingsError(409, "This code changed. Reload before saving again.");
        [row] = await tx.insert(coupon).values({ id: randomUUID(), ...values, version: 1 }).returning();
      } else {
        const [existing] = await tx.select().from(coupon).where(eq(coupon.id, couponId)).for("update");
        if (!existing) throw new SettingsError(404, "Code not found.");
        if (existing.version !== input.version) throw new SettingsError(409, "This code changed since you opened it. Reload before saving again.");
        if (existing.code !== input.code && existing.usedCount > 0) {
          throw new SettingsError(409, "A code that has been used can't be renamed.", { code: "Create a new code instead." });
        }
        if (input.usageLimit !== null && input.usageLimit < existing.usedCount) {
          throw new SettingsError(409, "The limit can't be below the uses so far.", { usageLimit: `Already used or held ${existing.usedCount} times.` });
        }
        [row] = await tx.update(coupon).set({ ...values, version: existing.version + 1, updatedAt: now }).where(eq(coupon.id, couponId)).returning();
      }
      await tx.insert(auditEvent).values({ id: randomUUID(), actorId, action: couponId ? "coupon.updated" : "coupon.created", subjectId: row.id });
      return adminCoupon(row);
    });
  } catch (error) {
    if (isUniqueViolation(error, "coupon_code_unique")) throw new SettingsError(409, "That code already exists.", { code: "Choose a different code." });
    throw error;
  }
}
