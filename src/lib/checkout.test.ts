import assert from "node:assert/strict";
import test from "node:test";
import { checkoutInputSchema, orderLookupSchema, priceOrder, quoteInputSchema, type SellableVariant } from "./checkout.ts";

const variant = (id: string, priceCents: number, available: number): SellableVariant => ({
  variantId: id, productId: `p-${id}`, productName: `Item ${id}`, variantLabel: "One", sku: `SKU-${id}`, priceCents, available, imageSrc: null,
});
const valid = {
  checkoutKey: "6c1f7a52-2f36-4e3c-9c1e-6e0c9d3c2a11", email: " Alex@Example.com ", name: "Alex Morgan",
  address: "123 Sample Street", city: "New York", state: "NY", zip: "10001", lines: [{ variantId: "a", quantity: 2 }],
  shippingMethodId: "standard", couponCode: "", expectedTotalCents: 8900,
};

test("merchandise is priced from catalog rows only", () => {
  const small = priceOrder([{ variantId: "a", quantity: 2 }], [variant("a", 4000, 5)]);
  assert.deepEqual(small.problems, []);
  assert.equal(small.order.subtotalCents, 8000);
  assert.equal(small.order.lines[0].lineTotalCents, 8000);
  const two = priceOrder([{ variantId: "a", quantity: 3 }, { variantId: "b", quantity: 1 }], [variant("a", 4000, 5), variant("b", 3000, 1)]);
  assert.equal(two.order.subtotalCents, 15000);
});

test("missing and short stock are reported per item", () => {
  const { problems, order } = priceOrder(
    [{ variantId: "gone", quantity: 1 }, { variantId: "few", quantity: 3 }, { variantId: "ok", quantity: 1 }],
    [variant("few", 1000, 2), variant("ok", 1000, 1)],
  );
  assert.deepEqual(problems, [
    { variantId: "gone", reason: "unavailable", available: 0 },
    { variantId: "few", reason: "insufficient", available: 2, name: "Item few" },
  ]);
  assert.deepEqual(order.lines.map(line => line.variantId), ["ok"]);
});

test("checkout input is normalized, strict and bounded", () => {
  const parsed = checkoutInputSchema.parse(valid);
  assert.equal(parsed.email, "alex@example.com");
  assert.equal(parsed.couponCode, null, "an empty code means no code");
  assert.equal(checkoutInputSchema.parse({ ...valid, couponCode: " welcome10 " }).couponCode, "WELCOME10");
  for (const invalid of [
    { ...valid, price: 100 },
    { ...valid, email: "not-an-email" },
    { ...valid, state: "ZZ" },
    { ...valid, zip: "1000" },
    { ...valid, checkoutKey: "repeat" },
    { ...valid, lines: [] },
    { ...valid, lines: [{ variantId: "a", quantity: 0 }] },
    { ...valid, lines: [{ variantId: "a", quantity: 100 }] },
    { ...valid, lines: [{ variantId: "a", quantity: 1, price: 1 }] },
    { ...valid, lines: [{ variantId: "a", quantity: 1 }, { variantId: "a", quantity: 1 }] },
    { ...valid, shippingMethodId: "" },
    { ...valid, couponCode: "no spaces" },
    { ...valid, expectedTotalCents: -1 },
    { ...valid, expectedTotalCents: undefined },
  ]) assert.equal(checkoutInputSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("quotes and order lookups validate their own inputs", () => {
  assert.equal(quoteInputSchema.parse({ lines: [{ variantId: "a", quantity: 1 }], state: "CA" }).couponCode, null);
  assert.equal(quoteInputSchema.safeParse({ lines: [{ variantId: "a", quantity: 1 }], state: "PR" }).success, false);
  assert.deepEqual(orderLookupSchema.parse({ number: " cv-2001 ", email: "A@B.co" }), { number: "CV-2001", email: "a@b.co" });
  for (const number of ["2001", "CV-", "CV-20x1", "XX-2001"]) assert.equal(orderLookupSchema.safeParse({ number, email: "a@b.co" }).success, false);
});
