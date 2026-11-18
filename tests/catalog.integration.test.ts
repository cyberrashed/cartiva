import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AdminProduct, ProductInput } from "../src/lib/catalog-admin.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "Set DATABASE_URL to the isolated cartiva_test database.");
assert.equal(new URL(databaseUrl).pathname, "/cartiva_test", "Catalog integration tests may run only against cartiva_test.");
assert.ok(process.env.BETTER_AUTH_URL, "Set BETTER_AUTH_URL for handler requests.");
const origin = new URL(process.env.BETTER_AUTH_URL).origin;

test("catalog writes persist products, variants and stock with permissions, versions and movements", { timeout: 60_000 }, async t => {
  // All server imports occur after the isolated-database guard.
  const { auth } = await import("../src/server/auth.ts");
  const { pool } = await import("../src/server/db.ts");
  const { GET: list, POST: create } = await import("../src/app/api/admin/catalog/products/route.ts");
  const { PUT: update } = await import("../src/app/api/admin/catalog/products/[id]/route.ts");
  const { loadPublishedCatalog, saveCatalogProduct, CatalogError } = await import("../src/server/catalog.ts");
  const runId = randomUUID();
  const tag = runId.slice(0, 8).toUpperCase();
  const password = `Test-only-${randomUUID()}`;
  const fixtureEmails = ["customer", "staff", "manager", "admin"].map(label => `catalog-${runId}-${label}@example.test`);
  const fixtureIds: string[] = [];
  const productIds: string[] = [];
  const users: Record<string, { id: string; cookie: string }> = {};

  function request(path: string, cookie = "", method = "GET", body?: unknown, headers?: Record<string, string>) {
    return new Request(`${origin}${path}`, {
      method,
      headers: { origin, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  function input(overrides: Partial<ProductInput> = {}): ProductInput {
    return {
      version: 0, status: "draft", name: `QA Linen Throw ${tag}`, description: "A temporary QA product for catalog tests.",
      details: ["Washed linen"], category: "Home & living", vendor: "QA Goods", optionNames: ["Color", "Size"],
      swatches: { Flax: "#d8c8a8" },
      media: [{ id: "editorial-room", src: "/images/editorial-room.jpg", alt: "A quiet, sunlit contemporary living room.", label: "Living room" }],
      variants: [
        { options: ["Flax", "Small"], sku: `QA-${tag}-S`, price: 6400, compareAtPrice: null, stock: 5, expectedStock: null, mediaIds: ["editorial-room"] },
        { options: ["Flax", "Large"], sku: `QA-${tag}-L`, price: 8800, compareAtPrice: 9600, stock: 0, expectedStock: null, mediaIds: ["editorial-room"] },
      ],
      ...overrides,
    };
  }
  function editInput(product: AdminProduct, changes: Partial<ProductInput> = {}): ProductInput {
    return {
      ...input(), version: product.version, status: product.status, name: product.name,
      variants: product.variants.map(variant => ({
        id: variant.id, options: variant.options, sku: variant.sku, price: variant.price, compareAtPrice: variant.compareAtPrice,
        stock: variant.stock, expectedStock: variant.stock, mediaIds: variant.mediaIds,
      })),
      ...changes,
    };
  }
  async function rejects(promise: Promise<unknown>, status: number) {
    await assert.rejects(promise, (error: unknown) => error instanceof CatalogError && error.status === status);
  }
  async function fixture(index: number, role?: string) {
    const response = await auth.handler(request("/api/auth/sign-up/email", "", "POST", { name: `Catalog fixture ${index}`, email: fixtureEmails[index], password }));
    assert.equal(response.status, 200);
    const { user } = await response.json() as { user: { id: string } };
    fixtureIds.push(user.id);
    if (role) await pool.query("UPDATE \"user\" SET role = $1 WHERE id = $2", [role, user.id]);
    return { id: user.id, cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") };
  }

  try {
    await pool.query("DELETE FROM rate_limit");
    users.customer = await fixture(0);
    users.staff = await fixture(1, "staff");
    users.manager = await fixture(2, "manager");
    users.admin = await fixture(3, "administrator");

    await t.test("only catalog managers can list or write, and only from the Cartiva origin", async () => {
      assert.equal((await list(request("/api/admin/catalog/products"))).status, 401);
      assert.equal((await list(request("/api/admin/catalog/products", users.customer.cookie))).status, 403);
      assert.equal((await list(request("/api/admin/catalog/products", users.staff.cookie))).status, 403);
      assert.equal((await create(request("/api/admin/catalog/products", users.customer.cookie, "POST", input()))).status, 403);
      const hostile = await create(request("/api/admin/catalog/products", users.manager.cookie, "POST", input(), { origin: "https://evil.example" }));
      assert.equal(hostile.status, 403);
      const invalid = await create(request("/api/admin/catalog/products", users.manager.cookie, "POST", { ...input(), variants: [] }));
      assert.equal(invalid.status, 400);
      assert.ok((await invalid.json() as { fieldErrors: Record<string, string> }).fieldErrors.variants);
      const listed = await list(request("/api/admin/catalog/products", users.manager.cookie));
      assert.equal(listed.status, 200);
      assert.equal(listed.headers.get("cache-control"), "private, no-store");
    });

    let product: AdminProduct;
    await t.test("a draft is saved with balances and initial movements but stays out of the storefront", async () => {
      const response = await create(request("/api/admin/catalog/products", users.manager.cookie, "POST", input()));
      assert.equal(response.status, 201);
      product = (await response.json() as { product: AdminProduct }).product;
      productIds.push(product.id);
      assert.equal(product.status, "draft");
      assert.equal(product.version, 1);
      assert.match(product.slug, new RegExp(`^qa-linen-throw-${tag.toLowerCase()}`));
      assert.deepEqual(product.variants.map(variant => [variant.sku, variant.stock]), [[`QA-${tag}-S`, 5], [`QA-${tag}-L`, 0]]);
      const movements = await pool.query("SELECT m.delta, m.balance_after, m.reason, m.actor_id FROM stock_movement m JOIN catalog_variant v ON v.id = m.variant_id WHERE v.product_id = $1", [product.id]);
      assert.deepEqual(movements.rows, [{ delta: 5, balance_after: 5, reason: "initial", actor_id: users.manager.id }]);
      assert.ok(!(await loadPublishedCatalog()).some(item => item.id === product.id));
    });

    await t.test("publishing exposes the product with per-variant prices and stock", async () => {
      const response = await update(request(`/api/admin/catalog/products/${product.id}`, users.admin.cookie, "PUT", editInput(product, { status: "published" })), { params: Promise.resolve({ id: product.id }) });
      assert.equal(response.status, 200);
      product = (await response.json() as { product: AdminProduct }).product;
      assert.equal(product.version, 2);
      assert.ok(product.publishedAt);
      const published = (await loadPublishedCatalog()).find(item => item.id === product.id);
      assert.ok(published);
      assert.deepEqual(published.variants.map(variant => [variant.price, variant.compareAtPrice, variant.stock]), [[6400, undefined, 5], [8800, 9600, 0]]);
      assert.deepEqual(published.optionGroups.map(group => group.name), ["Color", "Size"]);
      assert.equal(published.colors[0].value, "#d8c8a8");
    });

    await t.test("stock edits are guarded by the starting count and recorded as adjustments", async () => {
      const stale = editInput(product);
      stale.variants[0] = { ...stale.variants[0], stock: 9, expectedStock: 4 };
      await rejects(saveCatalogProduct(users.manager.id, product.id, stale), 409);

      const changed = editInput(product);
      changed.variants[0] = { ...changed.variants[0], stock: 2 };
      changed.variants[1] = { ...changed.variants[1], stock: 7, price: 9000 };
      product = await saveCatalogProduct(users.manager.id, product.id, changed);
      assert.deepEqual(product.variants.map(variant => variant.stock), [2, 7]);
      const adjustments = await pool.query("SELECT v.sku, m.delta, m.balance_after FROM stock_movement m JOIN catalog_variant v ON v.id = m.variant_id WHERE v.product_id = $1 AND m.reason = 'adjustment' ORDER BY v.sku", [product.id]);
      assert.deepEqual(adjustments.rows, [{ sku: `QA-${tag}-L`, delta: 7, balance_after: 7 }, { sku: `QA-${tag}-S`, delta: -3, balance_after: 2 }]);
      const balance = await pool.query("SELECT SUM(on_hand)::int AS total FROM inventory_balance b JOIN catalog_variant v ON v.id = b.variant_id WHERE v.product_id = $1", [product.id]);
      const movementTotal = await pool.query("SELECT SUM(delta)::int AS total FROM stock_movement m JOIN catalog_variant v ON v.id = m.variant_id WHERE v.product_id = $1", [product.id]);
      assert.equal(balance.rows[0].total, movementTotal.rows[0].total, "every unit on hand is explained by movements");
    });

    await t.test("an outdated version is rejected and concurrent saves of one version let exactly one win", async () => {
      await rejects(saveCatalogProduct(users.manager.id, product.id, editInput({ ...product, version: product.version - 1 })), 409);
      const results = await Promise.allSettled([
        saveCatalogProduct(users.manager.id, product.id, editInput(product, { name: `QA Linen Throw ${tag} A` })),
        saveCatalogProduct(users.admin.id, product.id, editInput(product, { name: `QA Linen Throw ${tag} B` })),
      ]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const rejected = results.find(result => result.status === "rejected");
      assert.ok(rejected && rejected.reason instanceof CatalogError && rejected.reason.status === 409);
      product = (results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<AdminProduct>).value;
    });

    await t.test("SKUs stay unique across products, and removed variants are archived with their SKU reserved", async () => {
      const duplicate = await create(request("/api/admin/catalog/products", users.manager.cookie, "POST", input({ name: `QA Other ${tag}`, variants: [{ ...input().variants[0], sku: `qa-${tag}-s` }] })));
      assert.equal(duplicate.status, 409);
      assert.ok((await duplicate.json() as { fieldErrors: Record<string, string> }).fieldErrors["variants.0.sku"]);

      const removal = editInput(product);
      removal.variants = removal.variants.slice(0, 1);
      product = await saveCatalogProduct(users.manager.id, product.id, removal);
      assert.equal(product.variants.length, 1);
      const archived = await pool.query("SELECT sku, archived FROM catalog_variant WHERE product_id = $1 ORDER BY sku", [product.id]);
      assert.deepEqual(archived.rows, [{ sku: `QA-${tag}-L`, archived: true }, { sku: `QA-${tag}-S`, archived: false }]);
      assert.equal((await loadPublishedCatalog()).find(item => item.id === product.id)?.variants.length, 1);
      const reuse = editInput(product);
      reuse.variants.push({ options: ["Flax", "Large"], sku: `QA-${tag}-L`, price: 8800, compareAtPrice: null, stock: 1, expectedStock: null, mediaIds: ["editorial-room"] });
      await rejects(saveCatalogProduct(users.manager.id, product.id, reuse), 409);
    });

    await t.test("archiving hides the product, and bodies cannot inject unknown fields", async () => {
      const injected = await update(request(`/api/admin/catalog/products/${product.id}`, users.manager.cookie, "PUT", { ...editInput(product), storeId: "someone-else" }), { params: Promise.resolve({ id: product.id }) });
      assert.equal(injected.status, 400);
      product = await saveCatalogProduct(users.manager.id, product.id, editInput(product, { status: "archived" }));
      assert.ok(!(await loadPublishedCatalog()).some(item => item.id === product.id));
      const audit = await pool.query("SELECT action FROM audit_event WHERE subject_id = $1 ORDER BY created_at", [product.id]);
      assert.equal(audit.rows[0].action, "catalog_product.created.draft");
      assert.equal(audit.rows.at(-1).action, "catalog_product.updated.archived");
    });
  } finally {
    try {
      await pool.query("DELETE FROM catalog_product WHERE id = ANY($1::text[]) OR name LIKE $2", [productIds, `QA % ${tag}%`]);
      await pool.query("DELETE FROM audit_event WHERE actor_id = ANY($1::text[]) OR subject_id = ANY($2::text[])", [fixtureIds, productIds]);
      await pool.query("DELETE FROM \"user\" WHERE email = ANY($1::text[])", [fixtureEmails]);
      await pool.query("DELETE FROM rate_limit");
    } finally { await pool.end(); }
  }
});
