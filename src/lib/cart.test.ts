import assert from "node:assert/strict";
import test from "node:test";
import {
  money,
  sanitizeCart,
  subtotal,
  updateCart,
  type CartLine,
  type CartProduct,
} from "./cart.ts";

const chair: CartProduct = {
  id: "chair",
  variants: [
    { id: "natural", price: 12900, stock: 5, options: { Color: "Natural" } },
    { id: "black", price: 14900, stock: 2, options: { Color: "Black" } },
  ],
};
const lamp: CartProduct = {
  id: "lamp",
  variants: [{ id: "white", price: 2501, stock: 3, options: { Color: "White" } }],
};
const soldOut: CartProduct = {
  id: "sold-out",
  variants: [{ ...lamp.variants[0], stock: 0 }],
};
const products = [chair, lamp, soldOut];

test("persisted cart accepts only arrays and known sellable variant lines", () => {
  for (const value of [undefined, null, "[]", {}, 5]) {
    assert.deepEqual(sanitizeCart(value, products), []);
  }
  const invalid = [
    null,
    "chair",
    {},
    { productId: "unknown", quantity: 1, variantId: "natural" },
    { productId: "chair", quantity: 1, variantId: "white" },
    { productId: "sold-out", quantity: 1, variantId: "white" },
    ...[0, -1, 1.5, "2", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(quantity => ({
      productId: "chair", quantity, variantId: "natural",
    })),
  ];
  const valid = { productId: "lamp", quantity: 2, variantId: "white" };
  assert.deepEqual(sanitizeCart([...invalid, valid], products), [valid]);
});

test("legacy color carts migrate without losing another product", () => {
  assert.deepEqual(sanitizeCart([
    { productId: "chair", color: "Natural", quantity: 2 },
    { productId: "lamp", color: "White", quantity: 1 },
    { productId: "chair", color: "Blue", quantity: 1 },
  ], products), [
    { productId: "chair", variantId: "natural", quantity: 2 },
    { productId: "lamp", variantId: "white", quantity: 1 },
  ]);
});

test("legacy color selects one Single SKU and rejects ambiguous migrations", () => {
  const sets: CartProduct = { id: "mug", variants: [
    { id: "sage-pair", price: 5200, stock: 4, options: { Color: "Sage", Set: "Pair" } },
    { id: "sage-single", price: 2800, stock: 36, options: { Color: "Sage", Set: "Single" } },
    { id: "oat-pair", price: 6000, stock: 3, options: { Color: "Oat", Set: "Pair" } },
    { id: "oat-trio", price: 9000, stock: 3, options: { Color: "Oat", Set: "Trio" } },
  ] };
  assert.deepEqual(sanitizeCart([
    { productId: "mug", color: "Sage", quantity: 2 },
    { productId: "mug", color: "Oat", quantity: 2 },
  ], [sets]), [{ productId: "mug", variantId: "sage-single", quantity: 2 }]);
});

test("explicit invalid variant IDs never fall back to a valid legacy color", () => {
  for (const variantId of ["missing", "white", "", null, undefined, 1]) {
    assert.deepEqual(sanitizeCart([
      { productId: "chair", variantId, color: "Natural", quantity: 1 },
    ], products), []);
  }
});

test("duplicates merge and clamp independently for each variant", () => {
  const persisted = [
    { productId: "chair", quantity: 2, variantId: "natural" },
    { productId: "chair", quantity: 1, color: "Natural" },
    { productId: "chair", quantity: 99, variantId: "black" },
    { productId: "chair", quantity: 99, variantId: "natural" },
    { productId: "lamp", quantity: 99, variantId: "white" },
  ];
  const before = structuredClone(persisted);
  const normalized = sanitizeCart(persisted, products);
  assert.deepEqual(normalized, [
    { productId: "chair", quantity: 5, variantId: "natural" },
    { productId: "chair", quantity: 2, variantId: "black" },
    { productId: "lamp", quantity: 3, variantId: "white" },
  ]);
  assert.deepEqual(sanitizeCart(normalized, products), normalized);
  assert.deepEqual(persisted, before);
});

test("quantity edits preserve other variants and products while respecting SKU stock", () => {
  const lines: CartLine[] = [
    { productId: "chair", quantity: 2, variantId: "natural" },
    { productId: "chair", quantity: 2, variantId: "black" },
    { productId: "lamp", quantity: 1, variantId: "white" },
  ];
  const before = structuredClone(lines);
  assert.deepEqual(updateCart(lines, chair, "natural", 99), [
    { productId: "chair", quantity: 5, variantId: "natural" }, lines[1], lines[2],
  ]);
  assert.deepEqual(updateCart(lines, chair, "black", 1), [
    lines[0], { productId: "chair", quantity: 1, variantId: "black" }, lines[2],
  ]);
  assert.deepEqual(lines, before);
});

test("full stock in one variant does not block another and sold-out SKUs cannot be added", () => {
  const full: CartLine[] = [{ productId: "chair", quantity: 5, variantId: "natural" }];
  assert.deepEqual(updateCart(full, chair, "black", 1), [
    ...full, { productId: "chair", quantity: 1, variantId: "black" },
  ]);
  assert.deepEqual(updateCart([], soldOut, "white", 1), []);
});

test("zero or negative quantities remove only the selected variant", () => {
  const first = { productId: "chair", quantity: 2, variantId: "natural" };
  const second = { productId: "chair", quantity: 1, variantId: "black" };
  const other = { productId: "lamp", quantity: 1, variantId: "white" };
  for (const quantity of [0, -1]) {
    assert.deepEqual(updateCart([first, second, other], chair, "natural", quantity), [second, other]);
  }
  const empty = updateCart([first], chair, "natural", 0);
  assert.deepEqual(empty, []);
  assert.equal(subtotal(empty, products), 0);
});

test("invalid quantity edits and unknown IDs leave the cart unchanged", () => {
  const lines = [{ productId: "chair", quantity: 1, variantId: "natural" }];
  for (const quantity of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(updateCart(lines, chair, "natural", quantity), lines);
  }
  assert.deepEqual(updateCart(lines, chair, "missing", 1), lines);
  assert.deepEqual(updateCart(lines, chair, "white", 1), lines);
});

test("subtotal uses current per-variant cents, ignoring injected prices and invalid lines", () => {
  const lines = [
    { productId: "chair", quantity: 2, variantId: "natural", price: 1 },
    { productId: "chair", quantity: 1, variantId: "black", price: 1 },
    { productId: "lamp", quantity: 3, variantId: "white", price: 1 },
    { productId: "unknown", quantity: 100, variantId: "natural", price: 1 },
  ];
  assert.equal(subtotal(lines, products), 48203);
  assert.equal(subtotal([], products), 0);
  assert.equal(subtotal(lines, []), 0);
  const repriced = { ...chair, variants: chair.variants.map(variant => ({ ...variant, price: variant.price + 100 })) };
  assert.equal(subtotal(lines, [repriced, lamp]), 48503);
  assert.equal(subtotal([{ productId: "lamp", quantity: 99, variantId: "white" }], products), 7503);
});



test("USD formatting preserves cents, including zero", () => {
  assert.equal(money(0), "$0.00");
  assert.equal(money(1), "$0.01");
  assert.equal(money(12900), "$129.00");
  assert.equal(money(33303), "$333.03");
});
