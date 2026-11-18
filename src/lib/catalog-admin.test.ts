import assert from "node:assert/strict";
import test from "node:test";
import {
  fieldErrorsFrom, parsePriceCents, productInputSchema, productToInput, slugify, toStorefrontProduct,
  type AdminProduct, type CatalogRecord, type ProductInput,
} from "./catalog-admin.ts";
import { editorFromProduct, editorToInput, emptyEditor, validateEditor } from "./catalog-editor-state.ts";
import { sampleProducts } from "./sample-catalog.ts";

function recordFrom(id: string, slug: string, input: ProductInput, reserved = 0): CatalogRecord {
  return {
    id, slug, name: input.name, category: input.category, vendor: input.vendor, description: input.description,
    details: input.details, optionNames: input.optionNames, swatches: input.swatches, media: input.media,
    variants: input.variants.map(variant => ({
      id: variant.id ?? `${id}-${variant.sku}`, sku: variant.sku,
      options: Object.fromEntries(input.optionNames.map((name, index) => [name, variant.options[index]])),
      price: variant.price, compareAtPrice: variant.compareAtPrice, onHand: variant.stock, reserved, mediaIds: variant.mediaIds,
    })),
  };
}

function mugInput(): ProductInput {
  const mug = sampleProducts.find(product => product.id === "ritual-ceramic-mug")!;
  return productInputSchema.parse(productToInput(mug));
}

test("every sample product converts to valid input and back to the same storefront product", () => {
  for (const product of sampleProducts) {
    const input = productInputSchema.parse(productToInput(product));
    const shaped = toStorefrontProduct(recordFrom(product.id, product.slug, input));
    assert.ok(shaped, product.id);
    assert.equal(shaped.price, product.variants[0].price, product.id);
    assert.equal(shaped.stock, product.variants.reduce((sum, variant) => sum + variant.stock, 0), product.id);
    assert.equal(shaped.image, product.variants[0].mediaIds.length ? product.media.find(item => item.id === product.variants[0].mediaIds[0])!.src : product.image);
    assert.deepEqual(shaped.variants.map(variant => [variant.id, variant.sku, variant.price, variant.stock, variant.mediaIds]),
      product.variants.map(variant => [variant.id, variant.sku, variant.price, variant.stock, variant.mediaIds]), product.id);
    assert.deepEqual(shaped.optionGroups, product.optionGroups, product.id);
    assert.deepEqual(shaped.colors, product.colors, product.id);
  }
});

test("storefront stock subtracts reservations and never goes negative; broken media falls back to the cover", () => {
  const input = mugInput();
  const record = recordFrom("mug", "mug", input, 5);
  record.variants[0].mediaIds = ["missing"];
  const shaped = toStorefrontProduct(record)!;
  assert.deepEqual(shaped.variants.map(variant => variant.stock), [31, 0, 0, 0]);
  assert.deepEqual(shaped.variants[0].mediaIds, [input.media[0].id]);
  assert.equal(toStorefrontProduct({ ...record, variants: [] }), null);
  assert.equal(toStorefrontProduct({ ...record, media: [] }), null);
});

test("product input rejects duplicate SKUs, repeated combinations, low compare-at prices and foreign photos", () => {
  const base = mugInput();
  const cases: [string, (input: ProductInput) => unknown, string][] = [
    ["duplicate SKU, different case", input => ({ ...input, variants: input.variants.map((variant, index) => index === 1 ? { ...variant, sku: input.variants[0].sku.toLowerCase() } : variant) }), "variants.1.sku"],
    ["repeated option combination", input => ({ ...input, variants: input.variants.map((variant, index) => index === 1 ? { ...variant, options: [" sage ", "SINGLE"] } : variant) }), "variants.1.options"],
    ["compare-at equal to price", input => ({ ...input, variants: input.variants.map((variant, index) => index === 0 ? { ...variant, compareAtPrice: variant.price } : variant) }), "variants.0.compareAtPrice"],
    ["photo not on the product", input => ({ ...input, variants: input.variants.map((variant, index) => index === 2 ? { ...variant, mediaIds: ["main"] } : variant) }), "variants.2.mediaIds"],
    ["option count mismatch", input => ({ ...input, variants: input.variants.map((variant, index) => index === 3 ? { ...variant, options: ["Oat"] } : variant) }), "variants.3.options"],
    ["photo outside the library", input => ({ ...input, media: [{ ...input.media[0], src: "https://example.com/x.jpg" }, ...input.media.slice(1)] }), "media.0.src"],
    ["repeated option names", input => ({ ...input, optionNames: ["Color", " color "] }), "optionNames.1"],
    ["price that is not a number", input => ({ ...input, variants: input.variants.map((variant, index) => index === 0 ? { ...variant, price: Number.NaN } : variant) }), "variants.0.price"],
    ["negative stock", input => ({ ...input, variants: input.variants.map((variant, index) => index === 0 ? { ...variant, stock: -1 } : variant) }), "variants.0.stock"],
    ["unknown category", input => ({ ...input, category: "Garden" }), "category"],
    ["unexpected field", input => ({ ...input, role: "owner" }), "form"],
  ];
  for (const [name, change, key] of cases) {
    const result = productInputSchema.safeParse(change(structuredClone(base)));
    assert.equal(result.success, false, name);
    if (!result.success) assert.ok(key in fieldErrorsFrom(result.error), `${name}: ${JSON.stringify(fieldErrorsFrom(result.error))}`);
  }
  assert.equal(productInputSchema.parse({ ...base, variants: base.variants.map(variant => ({ ...variant, sku: variant.sku.toLowerCase() })) }).variants[0].sku, "CV-RIT-SAG-1");
});

test("prices parse to exact cents and slugs are URL-safe", () => {
  assert.equal(parsePriceCents("28"), 2800);
  assert.equal(parsePriceCents("28.5"), 2850);
  assert.equal(parsePriceCents(" $1,200.05 "), 120005);
  assert.equal(parsePriceCents("0.1"), 10);
  for (const invalid of ["", "28.555", "-1", "1e3", "twelve", "."]) assert.equal(parsePriceCents(invalid), null, invalid);
  assert.equal(slugify("Arc Lounge Chair"), "arc-lounge-chair");
  assert.equal(slugify("Café & Co."), "cafe-and-co");
  assert.equal(slugify("!!!"), "product");
  assert.ok(slugify("x".repeat(200)).length <= 60);
});

test("editor state round-trips saved products and reports field-level errors", () => {
  const input = mugInput();
  const admin: AdminProduct = {
    id: "mug", slug: "ritual-ceramic-mug", version: 3, status: "published", name: input.name, description: input.description,
    details: input.details, category: input.category, vendor: input.vendor, optionNames: input.optionNames, swatches: input.swatches,
    media: input.media, updatedAt: new Date(0).toISOString(), publishedAt: null,
    variants: input.variants.map(variant => ({ id: variant.id!, sku: variant.sku, options: variant.options, price: variant.price, compareAtPrice: variant.compareAtPrice, stock: variant.stock, mediaIds: variant.mediaIds })),
  };
  const state = editorFromProduct(admin);
  const valid = validateEditor(state);
  assert.deepEqual(valid.errors, {});
  assert.equal(valid.input?.version, 3);
  assert.deepEqual(valid.input?.variants.map(variant => variant.expectedStock), [36, 4, 3, 0]);

  state.variants[1].price = "";
  state.variants[2].stock = "2.5";
  state.variants[3].compareAt = "abc";
  const invalid = validateEditor(state);
  assert.ok(invalid.errors["variants.1.price"]);
  assert.ok(invalid.errors["variants.2.stock"]);
  assert.ok(invalid.errors["variants.3.compareAtPrice"]);

  const blank = validateEditor(emptyEditor("Tech"));
  assert.ok(blank.errors.name && blank.errors.media && blank.errors["variants.0.sku"]);
  assert.equal((editorToInput({ ...emptyEditor("Tech"), details: " one \n\n two " }) as { details: string[] }).details.join("|"), "one|two");
});
