import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultVariant, getVariant, getVariantLabel, getVariantMedia } from "./catalog.ts";
import { sampleProducts as products } from "./sample-catalog.ts";
import { sanitizeCart, subtotal } from "./cart.ts";

test("catalog variants have unique IDs, SKUs, valid option combinations and integer cents", () => {
  const ids = new Set<string>();
  const skus = new Set<string>();
  for (const product of products) {
    assert.ok(product.variants.length > 0, product.id);
    const combinations = new Set<string>();
    for (const variant of product.variants) {
      assert.ok(!ids.has(variant.id), variant.id);
      assert.ok(!skus.has(variant.sku), variant.sku);
      ids.add(variant.id);
      skus.add(variant.sku);
      assert.ok(Number.isSafeInteger(variant.price) && variant.price > 0, variant.id);
      assert.ok(Number.isSafeInteger(variant.stock) && variant.stock >= 0, variant.id);
      assert.deepEqual(Object.keys(variant.options).sort(), product.optionGroups.map(group => group.name).sort());
      for (const group of product.optionGroups) {
        assert.ok(group.values.some(value => value.name === variant.options[group.name]), `${variant.id}: ${group.name}`);
      }
      const combination = JSON.stringify(product.optionGroups.map(group => variant.options[group.name]));
      assert.ok(!combinations.has(combination), variant.id);
      combinations.add(combination);
    }
  }
});

test("legacy card fields agree with the first variant and its primary media", () => {
  for (const product of products) {
    const variant = getDefaultVariant(product);
    const media = getVariantMedia(product, variant)[0];
    assert.equal(product.price, variant.price);
    assert.equal(product.compareAtPrice, variant.compareAtPrice);
    assert.equal(product.stock, variant.stock);
    assert.equal(product.color, variant.options.Color);
    assert.equal(product.image, media.src);
    assert.equal(product.imageAlt, media.alt);
    assert.equal(getVariant(product, "unknown"), undefined);
  }
});

test("each variant resolves distinct, labeled media without borrowing another color", () => {
  for (const product of products) {
    assert.equal(new Set(product.media.map(media => media.id)).size, product.media.length);
    for (const variant of product.variants) {
      const media = getVariantMedia(product, variant);
      assert.ok(media.length > 0, variant.id);
      assert.equal(media.length, variant.mediaIds.length);
      assert.equal(new Set(media.map(item => item.src)).size, media.length);
      assert.ok(media.every(item => item.alt.trim() && item.label.trim() && item.src.startsWith("/images/")));
      assert.deepEqual(media.map(item => item.id), variant.mediaIds);
    }
  }
  const mug = products.find(product => product.id === "ritual-ceramic-mug")!;
  assert.deepEqual(getVariantMedia(mug, getVariant(mug, "ritual-oat-single")!).map(media => media.id), ["oat"]);
  assert.deepEqual(getVariantMedia(mug, { ...mug.variants[0], mediaIds: ["missing"] }), []);
});

test("mug choices preserve different prices, availability and old individual-mug carts", () => {
  const mug = products.find(product => product.id === "ritual-ceramic-mug")!;
  const pair = getVariant(mug, "ritual-sage-pair")!;
  assert.equal(getVariantLabel(pair), "Sage · Pair");
  assert.equal(pair.price, 5200);
  assert.equal(pair.stock, 4);
  assert.equal(getVariant(mug, "ritual-oat-pair")!.stock, 0);
  const cart = sanitizeCart([
    { productId: mug.id, color: "Sage", quantity: 2 },
    { productId: mug.id, variantId: pair.id, quantity: 1 },
    { productId: mug.id, variantId: "ritual-oat-single", quantity: 1 },
    { productId: mug.id, variantId: "ritual-oat-pair", quantity: 1 },
  ], products);
  assert.deepEqual(cart.map(line => line.variantId), ["ritual-sage-single", "ritual-sage-pair", "ritual-oat-single"]);
  assert.equal(subtotal(cart, products), 14000);
});
