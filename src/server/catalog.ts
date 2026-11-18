import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Product } from "../lib/catalog";
import {
  slugify, toStorefrontProduct,
  type AdminProduct, type CatalogRecord, type ProductInput,
} from "../lib/catalog-admin";
import { db } from "./db";
import { isUniqueViolation, violates } from "./db-errors";
import { auditEvent, catalogProduct, catalogVariant, inventoryBalance, stockMovement } from "./schema";

export class CatalogError extends Error {
  constructor(public status: number, message: string, public fieldErrors?: Record<string, string>) {
    super(message);
  }
}

type ProductRow = typeof catalogProduct.$inferSelect;
type VariantRow = typeof catalogVariant.$inferSelect & { onHand: number; reserved: number };

async function variantsFor(productIds: string[], executor: Pick<typeof db, "select"> = db): Promise<Map<string, VariantRow[]>> {
  const grouped = new Map<string, VariantRow[]>();
  if (!productIds.length) return grouped;
  const rows = await executor.select({ variant: catalogVariant, onHand: inventoryBalance.onHand, reserved: inventoryBalance.reserved })
    .from(catalogVariant).innerJoin(inventoryBalance, eq(inventoryBalance.variantId, catalogVariant.id))
    .where(and(inArray(catalogVariant.productId, productIds), eq(catalogVariant.archived, false)))
    .orderBy(asc(catalogVariant.position), asc(catalogVariant.createdAt));
  for (const row of rows) {
    const list = grouped.get(row.variant.productId) ?? [];
    list.push({ ...row.variant, onHand: row.onHand, reserved: row.reserved });
    grouped.set(row.variant.productId, list);
  }
  return grouped;
}

function record(product: ProductRow, variants: VariantRow[]): CatalogRecord {
  return {
    id: product.id, slug: product.slug, name: product.name, category: product.category, vendor: product.vendorName,
    description: product.description, details: product.details, optionNames: product.optionNames,
    swatches: product.swatches, media: product.media,
    variants: variants.map(variant => ({
      id: variant.id, sku: variant.sku, options: variant.options, price: variant.priceCents,
      compareAtPrice: variant.compareAtCents, onHand: variant.onHand, reserved: variant.reserved, mediaIds: variant.mediaIds,
    })),
  };
}

function adminProduct(product: ProductRow, variants: VariantRow[]): AdminProduct {
  return {
    id: product.id, slug: product.slug, version: product.version, status: product.status,
    name: product.name, description: product.description, details: product.details, category: product.category,
    vendor: product.vendorName, optionNames: product.optionNames, swatches: product.swatches, media: product.media,
    variants: variants.map(variant => ({
      id: variant.id, sku: variant.sku, options: product.optionNames.map(name => variant.options[name] ?? ""),
      price: variant.priceCents, compareAtPrice: variant.compareAtCents, stock: variant.onHand, mediaIds: variant.mediaIds,
    })),
    updatedAt: product.updatedAt.toISOString(),
    publishedAt: product.publishedAt?.toISOString() ?? null,
  };
}

/** Published products with sellable variants, in storefront order. Uncached; see catalog-cache.ts. */
export async function loadPublishedCatalog(): Promise<Product[]> {
  const products = await db.select().from(catalogProduct).where(eq(catalogProduct.status, "published"))
    .orderBy(asc(catalogProduct.position), asc(catalogProduct.createdAt));
  const variants = await variantsFor(products.map(product => product.id));
  return products.flatMap(product => {
    const shaped = toStorefrontProduct(record(product, variants.get(product.id) ?? []));
    return shaped ? [shaped] : [];
  });
}

// Callers must enforce catalog:manage first.
export async function listAdminProducts(): Promise<AdminProduct[]> {
  const products = await db.select().from(catalogProduct).orderBy(asc(catalogProduct.position), asc(catalogProduct.createdAt));
  const variants = await variantsFor(products.map(product => product.id));
  return products.map(product => adminProduct(product, variants.get(product.id) ?? []));
}

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function availableSlug(tx: Executor, name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set((await tx.select({ slug: catalogProduct.slug }).from(catalogProduct)).map(row => row.slug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base.slice(0, 55)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 40)}-${randomUUID().slice(0, 8)}`;
}

/**
 * Creates (`productId` undefined) or updates a product, its variants and on-hand
 * balances in one transaction. Callers must enforce catalog:manage first.
 * `version` guards the product; `expectedStock` guards each existing balance so a
 * concurrent stock change is never silently overwritten.
 */
export async function saveCatalogProduct(actorId: string, productId: string | undefined, input: ProductInput): Promise<AdminProduct> {
  try {
    return await db.transaction(async tx => {
      const now = new Date();
      const optionsRecord = (values: string[]) => Object.fromEntries(input.optionNames.map((name, index) => [name, values[index]]));
      let product: ProductRow;
      if (!productId) {
        if (input.version !== 0) throw new CatalogError(409, "This product changed. Reload it before saving again.");
        if (input.variants.some(variant => variant.id)) throw new CatalogError(400, "New products cannot reuse existing variants.");
        [product] = await tx.insert(catalogProduct).values({
          id: randomUUID(), slug: await availableSlug(tx, input.name), name: input.name, category: input.category,
          vendorName: input.vendor, description: input.description, details: input.details, optionNames: input.optionNames,
          swatches: input.swatches, media: input.media, status: input.status, position: 1000, version: 1,
          publishedAt: input.status === "published" ? now : null,
        }).returning();
      } else {
        const [existing] = await tx.select().from(catalogProduct).where(eq(catalogProduct.id, productId)).for("update");
        if (!existing) throw new CatalogError(404, "Product not found.");
        if (existing.version !== input.version) throw new CatalogError(409, "This product changed since you opened it. Reload it before saving again.");
        [product] = await tx.update(catalogProduct).set({
          name: input.name, category: input.category, vendorName: input.vendor, description: input.description,
          details: input.details, optionNames: input.optionNames, swatches: input.swatches, media: input.media,
          status: input.status, version: existing.version + 1, updatedAt: now,
          publishedAt: input.status === "published" ? existing.publishedAt ?? now : existing.publishedAt,
        }).where(and(eq(catalogProduct.id, productId), eq(catalogProduct.version, input.version))).returning();
        if (!product) throw new CatalogError(409, "This product changed since you opened it. Reload it before saving again.");
      }

      const current = productId
        ? await tx.select({ variant: catalogVariant, onHand: inventoryBalance.onHand, reserved: inventoryBalance.reserved })
          .from(catalogVariant).innerJoin(inventoryBalance, eq(inventoryBalance.variantId, catalogVariant.id))
          .where(and(eq(catalogVariant.productId, product.id), eq(catalogVariant.archived, false))).for("update")
        : [];
      const currentById = new Map(current.map(row => [row.variant.id, row]));

      // A SKU may belong to only one variant, ever. Report conflicts per field.
      const skuOwners = await tx.select({ id: catalogVariant.id, sku: catalogVariant.sku }).from(catalogVariant)
        .where(inArray(catalogVariant.sku, input.variants.map(variant => variant.sku)));
      const skuErrors: Record<string, string> = {};
      input.variants.forEach((variant, index) => {
        const owner = skuOwners.find(row => row.sku === variant.sku);
        if (owner && owner.id !== variant.id) skuErrors[`variants.${index}.sku`] = "This SKU is already used by another variant.";
      });
      if (Object.keys(skuErrors).length) throw new CatalogError(409, "Choose SKUs that are not already in the catalog.", skuErrors);

      const keep = new Set<string>();
      for (const [index, variant] of input.variants.entries()) {
        if (variant.id) {
          const existing = currentById.get(variant.id);
          if (!existing) throw new CatalogError(409, "A variant was removed or changed elsewhere. Reload the product before saving again.");
          keep.add(variant.id);
          if (variant.expectedStock === null || variant.expectedStock !== existing.onHand) {
            throw new CatalogError(409, "Stock changed since you opened this product. Reload it to see the current counts.", { [`variants.${index}.stock`]: `On hand is now ${existing.onHand}.` });
          }
          if (variant.stock < existing.reserved) {
            const held = `${existing.reserved} ${existing.reserved === 1 ? "unit is" : "units are"} held by open checkouts`;
            throw new CatalogError(409, "On hand can't be lower than the stock held by open checkouts.", { [`variants.${index}.stock`]: `${held}; enter at least ${existing.reserved}.` });
          }
          await tx.update(catalogVariant).set({
            sku: variant.sku, options: optionsRecord(variant.options), priceCents: variant.price,
            compareAtCents: variant.compareAtPrice, mediaIds: variant.mediaIds, position: index, updatedAt: now,
          }).where(eq(catalogVariant.id, variant.id));
          const delta = variant.stock - existing.onHand;
          if (delta !== 0) {
            const [balance] = await tx.update(inventoryBalance).set({ onHand: variant.stock, updatedAt: now })
              .where(and(eq(inventoryBalance.variantId, variant.id), eq(inventoryBalance.onHand, existing.onHand))).returning();
            if (!balance) throw new CatalogError(409, "Stock changed since you opened this product. Reload it to see the current counts.");
            await tx.insert(stockMovement).values({ id: randomUUID(), variantId: variant.id, delta, balanceAfter: variant.stock, reason: "adjustment", actorId });
          }
        } else {
          const id = randomUUID();
          keep.add(id);
          await tx.insert(catalogVariant).values({
            id, productId: product.id, sku: variant.sku, options: optionsRecord(variant.options), priceCents: variant.price,
            compareAtCents: variant.compareAtPrice, mediaIds: variant.mediaIds, position: index,
          });
          await tx.insert(inventoryBalance).values({ variantId: id, onHand: variant.stock });
          if (variant.stock > 0) {
            await tx.insert(stockMovement).values({ id: randomUUID(), variantId: id, delta: variant.stock, balanceAfter: variant.stock, reason: "initial", actorId });
          }
        }
      }
      // Removed variants are archived, not deleted, so their SKU and stock history remain.
      const removed = current.map(row => row.variant.id).filter(id => !keep.has(id));
      if (removed.length) {
        await tx.update(catalogVariant).set({ archived: true, updatedAt: now })
          .where(and(eq(catalogVariant.productId, product.id), inArray(catalogVariant.id, removed)));
      }
      await tx.insert(auditEvent).values({
        id: randomUUID(), actorId, subjectId: product.id,
        action: productId ? `catalog_product.updated.${input.status}` : `catalog_product.created.${input.status}`,
      });
      const variants = await variantsFor([product.id], tx);
      return adminProduct(product, variants.get(product.id) ?? []);
    });
  } catch (error) {
    if (isUniqueViolation(error, "catalog_variant_sku_unique")) {
      throw new CatalogError(409, "Choose SKUs that are not already in the catalog.");
    }
    // A checkout can take a hold between the read above and this write.
    if (violates(error, "23514", "inventory_balance_reserved_valid")) {
      throw new CatalogError(409, "Stock is held by an open checkout. Reload the product to see the current counts.");
    }
    throw error;
  }
}

/** Idempotent seed used by scripts/seed-catalog.ts: inserts missing products, never overwrites edits. */
export async function seedCatalogProduct(input: ProductInput & { id: string; slug: string; position: number }): Promise<boolean> {
  return db.transaction(async tx => {
    const [exists] = await tx.select({ id: catalogProduct.id }).from(catalogProduct)
      .where(eq(catalogProduct.id, input.id)).limit(1);
    if (exists) return false;
    const [slugTaken] = await tx.select({ id: catalogProduct.id }).from(catalogProduct)
      .where(and(eq(catalogProduct.slug, input.slug), ne(catalogProduct.id, input.id))).limit(1);
    if (slugTaken) return false;
    const now = new Date();
    await tx.insert(catalogProduct).values({
      id: input.id, slug: input.slug, name: input.name, category: input.category, vendorName: input.vendor,
      description: input.description, details: input.details, optionNames: input.optionNames, swatches: input.swatches,
      media: input.media, status: input.status, position: input.position, publishedAt: input.status === "published" ? now : null,
    });
    for (const [index, variant] of input.variants.entries()) {
      const id = variant.id ?? randomUUID();
      await tx.insert(catalogVariant).values({
        id, productId: input.id, sku: variant.sku,
        options: Object.fromEntries(input.optionNames.map((name, position) => [name, variant.options[position]])),
        priceCents: variant.price, compareAtCents: variant.compareAtPrice, mediaIds: variant.mediaIds, position: index,
      });
      await tx.insert(inventoryBalance).values({ variantId: id, onHand: variant.stock });
      if (variant.stock > 0) {
        await tx.insert(stockMovement).values({ id: randomUUID(), variantId: id, delta: variant.stock, balanceAfter: variant.stock, reason: "initial", actorId: null });
      }
    }
    return true;
  });
}
