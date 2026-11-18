import assert from "node:assert/strict";
import test from "node:test";
import {
  couponInputSchema, defaultShippingConfig, deliveryWindow, evaluateCoupon, freeDeliveryHint,
  shippingConfigSchema, shippingMethodsFor, totalsFor, type CouponRule, type ShippingConfig,
} from "./checkout-settings.ts";

const now = new Date("2026-11-13T12:00:00Z");
const rule = (overrides: Partial<CouponRule> = {}): CouponRule => ({
  code: "WELCOME10", kind: "percent", percentOff: 10, amountOffCents: null, minSubtotalCents: 0,
  startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, active: true, ...overrides,
});

test("the default shipping settings are valid and cover every state exactly once", () => {
  const config = shippingConfigSchema.parse(defaultShippingConfig);
  const states = config.zones.flatMap(zone => zone.states);
  assert.equal(states.length, new Set(states).size);
  assert.equal(states.length, 51);
});

test("delivery methods follow the state's zone, free-delivery thresholds and pickup eligibility", () => {
  const ny = shippingMethodsFor(defaultShippingConfig, "NY", 9000);
  assert.deepEqual(ny.map(method => [method.id, method.priceCents]), [["standard", 900], ["express", 2400], ["studio-pickup", 0]]);
  assert.equal(ny[2].kind, "pickup");
  assert.equal(shippingMethodsFor(defaultShippingConfig, "CA", 14999)[0].priceCents, 900, "one cent below the threshold still pays");
  assert.equal(shippingMethodsFor(defaultShippingConfig, "CA", 15000)[0].priceCents, 0, "the threshold itself ships free");
  assert.equal(shippingMethodsFor(defaultShippingConfig, "CA", 15000)[1].priceCents, 2400, "express has no threshold");
  assert.deepEqual(shippingMethodsFor(defaultShippingConfig, "CA", 1000).map(method => method.id), ["standard", "express"], "no pickup outside NY/NJ/CT");
  assert.deepEqual(shippingMethodsFor(defaultShippingConfig, "HI", 99999).map(method => [method.id, method.priceCents]), [["standard-remote", 1900]]);
  assert.deepEqual(shippingMethodsFor(defaultShippingConfig, "TX", 1000, true).map(method => method.priceCents), [0, 0], "a free-shipping code frees every delivery rate");
  const withoutAlaska: ShippingConfig = { ...defaultShippingConfig, zones: defaultShippingConfig.zones.filter(zone => zone.id !== "alaska-hawaii") };
  assert.deepEqual(shippingMethodsFor(withoutAlaska, "AK", 1000), [], "an uncovered state gets no methods");
  const inactive: ShippingConfig = { ...defaultShippingConfig, zones: [{ ...defaultShippingConfig.zones[0], rates: defaultShippingConfig.zones[0].rates.map(rate => ({ ...rate, active: rate.id !== "express" })) }] };
  assert.deepEqual(shippingMethodsFor(inactive, "TX", 1000).map(method => method.id), ["standard"]);
  assert.equal(deliveryWindow({ minDays: 3, maxDays: 5 }), "3–5 business days");
  assert.equal(deliveryWindow({ minDays: 1, maxDays: 1 }), "1 business day");
  assert.equal(deliveryWindow({ minDays: null, maxDays: null }), null);
  assert.deepEqual(freeDeliveryHint(defaultShippingConfig), { thresholdCents: 15000, zoneName: "Contiguous US" });
});

test("shipping settings reject overlaps, duplicate IDs and impossible windows", () => {
  const zone = defaultShippingConfig.zones[0];
  const cases: ShippingConfig[] = [
    { ...defaultShippingConfig, zones: [zone, { ...defaultShippingConfig.zones[1], states: ["AK", "TX"] }] },
    { ...defaultShippingConfig, zones: [{ ...zone, states: ["TX", "TX"] }] },
    { ...defaultShippingConfig, zones: [zone, { ...defaultShippingConfig.zones[1], id: "contiguous-us" }] },
    { ...defaultShippingConfig, zones: [{ ...zone, rates: [{ ...zone.rates[0], minDays: 6, maxDays: 2 }] }] },
    { ...defaultShippingConfig, zones: [{ ...zone, rates: [] }] },
    { ...defaultShippingConfig, zones: [{ ...zone, rates: [{ ...zone.rates[0], priceCents: -1 }] }] },
    { ...defaultShippingConfig, zones: [{ ...zone, rates: [{ ...zone.rates[0], id: "Bad ID" }] }] },
    { ...defaultShippingConfig, pickups: [{ ...defaultShippingConfig.pickups[0], id: "standard" }] },
    { ...defaultShippingConfig, pickups: [{ ...defaultShippingConfig.pickups[0], states: ["PR" as "NY"] }] },
  ];
  for (const config of cases) assert.equal(shippingConfigSchema.safeParse(config).success, false, JSON.stringify(config).slice(0, 120));
});

test("coupons apply their discount only within dates, limits and minimums", () => {
  assert.deepEqual(evaluateCoupon(rule(), "WELCOME10", 12345, now), { ok: true, code: "WELCOME10", discountCents: 1235, freeShipping: false, label: "10% off" });
  assert.equal((evaluateCoupon(rule({ kind: "fixed", percentOff: null, amountOffCents: 2000 }), "X", 1500, now) as { discountCents: number }).discountCents, 1500, "a fixed amount never exceeds the subtotal");
  assert.deepEqual(evaluateCoupon(rule({ kind: "free_shipping", percentOff: null }), "SHIP", 1000, now), { ok: true, code: "WELCOME10", discountCents: 0, freeShipping: true, label: "Free delivery" });
  const refused = (value: CouponRule | null, subtotal = 5000) => {
    const outcome = evaluateCoupon(value, "CODE", subtotal, now);
    assert.equal(outcome.ok, false);
    return (outcome as { message: string }).message;
  };
  assert.match(refused(null), /isn't valid/);
  assert.match(refused(rule({ active: false })), /isn't valid/);
  assert.match(refused(rule({ startsAt: new Date("2026-11-14T00:00:00Z") })), /isn't active yet/);
  assert.match(refused(rule({ endsAt: now })), /expired/);
  assert.match(refused(rule({ usageLimit: 3, usedCount: 3 })), /limit/);
  assert.match(refused(rule({ minSubtotalCents: 6000 })), /Add \$10\.00 more/);
  assert.equal(evaluateCoupon(rule({ usageLimit: 3, usedCount: 2 }), "X", 5000, now).ok, true);
});

test("coupon settings require the right value for each kind and a sensible window", () => {
  const base = { version: 0, code: "welcome10", kind: "percent", percentOff: 10, amountOffCents: null, minSubtotalCents: 0, startsAt: null, endsAt: null, usageLimit: null, active: true };
  assert.equal(couponInputSchema.parse(base).code, "WELCOME10");
  for (const invalid of [
    { ...base, percentOff: null },
    { ...base, percentOff: 101 },
    { ...base, kind: "fixed" },
    { ...base, kind: "free_shipping" },
    { ...base, code: "a b" },
    { ...base, code: "ab" },
    { ...base, startsAt: "2026-11-14T00:00:00Z", endsAt: "2026-11-13T00:00:00Z" },
    { ...base, usageLimit: 0 },
    { ...base, extra: true },
  ]) assert.equal(couponInputSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("totals are subtotal minus discount plus delivery, with tax not collected", () => {
  const [standard] = shippingMethodsFor(defaultShippingConfig, "TX", 8000);
  assert.deepEqual(totalsFor(10000, 2000, standard), { subtotalCents: 10000, discountCents: 2000, shippingCents: 900, taxCents: 0, totalCents: 8900 });
  assert.equal(totalsFor(10000, 0, null).totalCents, 10000);
});
