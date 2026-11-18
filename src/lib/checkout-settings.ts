import { z } from "zod";
import { money } from "./cart.ts";
import { usStates } from "./seller-application.ts";

// Shipping: zones of US states with delivery rates, plus pickup locations.
export const MAX_ZONES = 10;
export const MAX_RATES_PER_ZONE = 6;
export const MAX_PICKUPS = 5;
const MAX_SHIPPING_CENTS = 100_000;

const id = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use lowercase letters, numbers and hyphens.");
const label = (max: number, message: string) => z.string().trim().min(1, message).max(max, `Use ${max} characters or fewer.`);
const days = z.number().int().min(0, "Use 0–60 days.").max(60, "Use 0–60 days.").nullable();

export const shippingRateSchema = z.strictObject({
  id,
  name: label(60, "Name this rate."),
  priceCents: z.number().int().min(0, "Price can't be negative.").max(MAX_SHIPPING_CENTS, "Use $1,000 or less."),
  freeOverCents: z.number().int().positive("Use an amount above $0, or leave it empty.").max(10_000_000).nullable(),
  minDays: days,
  maxDays: days,
  active: z.boolean(),
}).superRefine((rate, context) => {
  if (rate.minDays !== null && rate.maxDays !== null && rate.minDays > rate.maxDays) {
    context.addIssue({ code: "custom", path: ["maxDays"], message: "The latest day can't be before the earliest." });
  }
});

export const shippingZoneSchema = z.strictObject({
  id,
  name: label(60, "Name this zone."),
  states: z.array(z.enum(usStates)).min(1, "Choose at least one state.").max(usStates.length),
  rates: z.array(shippingRateSchema).min(1, "Add at least one rate.").max(MAX_RATES_PER_ZONE, `Use up to ${MAX_RATES_PER_ZONE} rates.`),
});

export const pickupSchema = z.strictObject({
  id,
  name: label(60, "Name this pickup point."),
  address: label(160, "Enter the pickup address."),
  instructions: z.string().trim().max(300, "Use 300 characters or fewer."),
  states: z.array(z.enum(usStates)).min(1, "Choose who can pick up here.").max(usStates.length),
  active: z.boolean(),
});

export const shippingConfigSchema = z.strictObject({
  zones: z.array(shippingZoneSchema).max(MAX_ZONES, `Use up to ${MAX_ZONES} zones.`),
  pickups: z.array(pickupSchema).max(MAX_PICKUPS, `Use up to ${MAX_PICKUPS} pickup points.`),
}).superRefine((config, context) => {
  // A state belongs to one zone, so its delivery prices are never ambiguous.
  const owner = new Map<string, number>();
  config.zones.forEach((zone, zoneIndex) => {
    const seen = new Set<string>();
    zone.states.forEach((state, stateIndex) => {
      if (seen.has(state)) context.addIssue({ code: "custom", path: ["zones", zoneIndex, "states", stateIndex], message: `${state} is listed twice.` });
      seen.add(state);
      const other = owner.get(state);
      if (other !== undefined && other !== zoneIndex) {
        context.addIssue({ code: "custom", path: ["zones", zoneIndex, "states"], message: `${state} is already in ${config.zones[other].name}.` });
      }
      owner.set(state, zoneIndex);
    });
  });
  // Option ids are what the browser sends back, so they must be unique.
  const ids = new Set<string>();
  const claim = (value: string, path: (string | number)[]) => {
    if (ids.has(value)) context.addIssue({ code: "custom", path, message: "Each zone, rate and pickup point needs its own ID." });
    ids.add(value);
  };
  config.zones.forEach((zone, zoneIndex) => {
    claim(zone.id, ["zones", zoneIndex, "id"]);
    zone.rates.forEach((rate, rateIndex) => claim(rate.id, ["zones", zoneIndex, "rates", rateIndex, "id"]));
  });
  config.pickups.forEach((pickup, index) => claim(pickup.id, ["pickups", index, "id"]));
});

export type ShippingRate = z.infer<typeof shippingRateSchema>;
export type ShippingZone = z.infer<typeof shippingZoneSchema>;
export type Pickup = z.infer<typeof pickupSchema>;
export type ShippingConfig = z.infer<typeof shippingConfigSchema>;

const contiguous = usStates.filter(state => state !== "AK" && state !== "HI");

/** Starting settings seeded by `db:seed`; staff change them in /admin/shipping. */
export const defaultShippingConfig: ShippingConfig = {
  zones: [
    {
      id: "contiguous-us", name: "Contiguous US", states: [...contiguous],
      rates: [
        { id: "standard", name: "Standard delivery", priceCents: 900, freeOverCents: 15_000, minDays: 3, maxDays: 5, active: true },
        { id: "express", name: "Express delivery", priceCents: 2400, freeOverCents: null, minDays: 1, maxDays: 2, active: true },
      ],
    },
    {
      id: "alaska-hawaii", name: "Alaska & Hawaii", states: ["AK", "HI"],
      rates: [{ id: "standard-remote", name: "Standard delivery", priceCents: 1900, freeOverCents: null, minDays: 5, maxDays: 8, active: true }],
    },
  ],
  pickups: [{
    id: "studio-pickup", name: "Pickup at the Cartiva studio", address: "Cartiva studio, Brooklyn, NY",
    instructions: "Ready in 1 business day. Bring your order number; we'll email when it's ready once email is connected.",
    states: ["NY", "NJ", "CT"], active: true,
  }],
};

export type ShippingMethod = {
  id: string;
  kind: "delivery" | "pickup";
  name: string;
  /** Price after any free-delivery threshold or free-shipping code. */
  priceCents: number;
  /** The listed price before free delivery applies. */
  basePriceCents: number;
  minDays: number | null;
  maxDays: number | null;
  zoneName: string | null;
  address: string | null;
  instructions: string | null;
};

/**
 * Methods a shopper in `state` can choose. Free-delivery thresholds use the
 * merchandise subtotal after discounts; a free-shipping code makes delivery free.
 */
export function shippingMethodsFor(config: ShippingConfig, state: string, discountedSubtotalCents: number, freeShipping = false): ShippingMethod[] {
  const methods: ShippingMethod[] = [];
  const zone = config.zones.find(item => item.states.includes(state as (typeof usStates)[number]));
  for (const rate of zone?.rates ?? []) {
    if (!rate.active) continue;
    const free = freeShipping || (rate.freeOverCents !== null && discountedSubtotalCents >= rate.freeOverCents);
    methods.push({
      id: rate.id, kind: "delivery", name: rate.name, priceCents: free ? 0 : rate.priceCents, basePriceCents: rate.priceCents,
      minDays: rate.minDays, maxDays: rate.maxDays, zoneName: zone!.name, address: null, instructions: null,
    });
  }
  for (const pickup of config.pickups) {
    if (!pickup.active || !pickup.states.includes(state as (typeof usStates)[number])) continue;
    methods.push({
      id: pickup.id, kind: "pickup", name: pickup.name, priceCents: 0, basePriceCents: 0, minDays: null, maxDays: null,
      zoneName: null, address: pickup.address, instructions: pickup.instructions || null,
    });
  }
  return methods;
}

/** "3–5 business days", "1 business day" or null. */
export function deliveryWindow(method: Pick<ShippingMethod, "minDays" | "maxDays">): string | null {
  const { minDays, maxDays } = method;
  if (minDays === null && maxDays === null) return null;
  const low = minDays ?? maxDays!;
  const high = maxDays ?? minDays!;
  return low === high ? `${low} business ${low === 1 ? "day" : "days"}` : `${low}–${high} business days`;
}

/** The lowest active free-delivery threshold, for the bag's progress hint. */
export function freeDeliveryHint(config: ShippingConfig): { thresholdCents: number; zoneName: string } | null {
  let best: { thresholdCents: number; zoneName: string } | null = null;
  for (const zone of config.zones) {
    for (const rate of zone.rates) {
      if (rate.active && rate.freeOverCents !== null && (!best || rate.freeOverCents < best.thresholdCents)) {
        best = { thresholdCents: rate.freeOverCents, zoneName: zone.name };
      }
    }
  }
  return best;
}

// Coupons: one code per order, no stacking.
export const couponKinds = ["percent", "fixed", "free_shipping"] as const;
export type CouponKind = (typeof couponKinds)[number];

export const couponCodeSchema = z.string().trim().toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/, "Use 3–32 letters, numbers, hyphens or underscores.");

export const couponInputSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  code: couponCodeSchema,
  kind: z.enum(couponKinds),
  percentOff: z.number().int().min(1, "Use 1–100%.").max(100, "Use 1–100%.").nullable(),
  amountOffCents: z.number().int().positive("Use an amount above $0.").max(10_000_000).nullable(),
  minSubtotalCents: z.number().int().min(0).max(10_000_000),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  usageLimit: z.number().int().positive("Use at least 1, or leave it empty.").max(1_000_000).nullable(),
  active: z.boolean(),
}).superRefine((value, context) => {
  if (value.kind === "percent" && value.percentOff === null) context.addIssue({ code: "custom", path: ["percentOff"], message: "Enter the percentage off." });
  if (value.kind === "fixed" && value.amountOffCents === null) context.addIssue({ code: "custom", path: ["amountOffCents"], message: "Enter the amount off." });
  if (value.kind !== "percent" && value.percentOff !== null) context.addIssue({ code: "custom", path: ["percentOff"], message: "Only percentage codes take a percentage." });
  if (value.kind !== "fixed" && value.amountOffCents !== null) context.addIssue({ code: "custom", path: ["amountOffCents"], message: "Only fixed-amount codes take an amount." });
  if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start." });
  }
});
export type CouponInput = z.infer<typeof couponInputSchema>;

export type CouponRule = {
  code: string;
  kind: CouponKind;
  percentOff: number | null;
  amountOffCents: number | null;
  minSubtotalCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  /** Held by open checkouts plus redeemed by paid orders. */
  usedCount: number;
  active: boolean;
};

export type CouponOutcome =
  | { ok: true; code: string; discountCents: number; freeShipping: boolean; label: string }
  | { ok: false; code: string; message: string };

export function describeCoupon(rule: Pick<CouponRule, "kind" | "percentOff" | "amountOffCents">): string {
  if (rule.kind === "percent") return `${rule.percentOff}% off`;
  if (rule.kind === "fixed") return `${money(rule.amountOffCents ?? 0)} off`;
  return "Free delivery";
}

/** Checks a code against the bag. Messages are safe to show the shopper. */
export function evaluateCoupon(rule: CouponRule | null, code: string, subtotalCents: number, now: Date): CouponOutcome {
  if (!rule || !rule.active) return { ok: false, code, message: "This code isn't valid." };
  if (rule.startsAt && now < rule.startsAt) return { ok: false, code, message: "This code isn't active yet." };
  if (rule.endsAt && now >= rule.endsAt) return { ok: false, code, message: "This code has expired." };
  if (rule.usageLimit !== null && rule.usedCount >= rule.usageLimit) return { ok: false, code, message: "This code has reached its limit." };
  if (subtotalCents < rule.minSubtotalCents) {
    return { ok: false, code, message: `Add ${money(rule.minSubtotalCents - subtotalCents)} more to use this code (minimum ${money(rule.minSubtotalCents)}).` };
  }
  const discountCents = rule.kind === "percent" ? Math.round(subtotalCents * (rule.percentOff ?? 0) / 100)
    : rule.kind === "fixed" ? Math.min(rule.amountOffCents ?? 0, subtotalCents) : 0;
  return { ok: true, code: rule.code, discountCents, freeShipping: rule.kind === "free_shipping", label: describeCoupon(rule) };
}

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

/** total = subtotal − discount + delivery + tax. Tax is not collected yet, so it is 0. */
export function totalsFor(subtotalCents: number, discountCents: number, method: ShippingMethod | null): Totals {
  const shippingCents = method?.priceCents ?? 0;
  const taxCents = 0;
  return { subtotalCents, discountCents, shippingCents, taxCents, totalCents: subtotalCents - discountCents + shippingCents + taxCents };
}
