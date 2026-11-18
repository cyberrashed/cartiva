import { z } from "zod";
import { categories, mediaLibrary, type Product, type ProductMedia, type ProductVariant } from "./catalog.ts";

export const productStatuses = ["draft", "published", "archived"] as const;
export type ProductStatus = (typeof productStatuses)[number];

export const MAX_VARIANTS = 12;
export const MAX_MEDIA = 6;
export const MAX_OPTION_GROUPS = 2;
export const MAX_PRICE_CENTS = 10_000_000;
export const MAX_STOCK = 100_000;

export type AdminVariant = {
  id: string;
  sku: string;
  /** Values aligned with the product's `optionNames`. */
  options: string[];
  price: number;
  compareAtPrice: number | null;
  /** On-hand units at the single default location. */
  stock: number;
  mediaIds: string[];
};

export type AdminProduct = {
  id: string;
  slug: string;
  version: number;
  status: ProductStatus;
  name: string;
  description: string;
  details: string[];
  category: string;
  vendor: string;
  optionNames: string[];
  swatches: Record<string, string>;
  media: ProductMedia[];
  variants: AdminVariant[];
  updatedAt: string;
  publishedAt: string | null;
};

/** A product as stored, before it is shaped for the storefront. */
export type CatalogRecord = {
  id: string;
  slug: string;
  name: string;
  category: string;
  vendor: string;
  description: string;
  details: string[];
  optionNames: string[];
  swatches: Record<string, string>;
  media: ProductMedia[];
  variants: {
    id: string;
    sku: string;
    options: Record<string, string>;
    price: number;
    compareAtPrice: number | null;
    onHand: number;
    reserved: number;
    mediaIds: string[];
  }[];
};

const librarySources = new Set(mediaLibrary.map(image => image.src));
const text = (max: number, message: string) => z.string().trim().min(1, message).max(max, message);

const mediaInputSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/, "Choose a photo from the library."),
  src: z.string().refine(src => librarySources.has(src), "Choose a photo from the library."),
  alt: text(200, "Describe the photo in 1–200 characters."),
  label: text(60, "Label the photo in 1–60 characters."),
});

const variantInputSchema = z.strictObject({
  id: z.string().min(1).max(64).optional(),
  options: z.array(text(40, "Enter an option value of 1–40 characters.")).min(1).max(MAX_OPTION_GROUPS),
  sku: z.string().trim().regex(/^[A-Za-z0-9_-]{1,48}$/, "Use 1–48 letters, numbers, hyphens or underscores.").transform(value => value.toUpperCase()),
  price: z.number({ error: "Enter a price above $0." }).int().positive("Enter a price above $0.").max(MAX_PRICE_CENTS, "Enter a price of $100,000 or less."),
  compareAtPrice: z.number({ error: "Enter a valid compare-at price, or leave it empty." }).int().positive().max(MAX_PRICE_CENTS, "Enter a price of $100,000 or less.").nullable(),
  stock: z.number({ error: "Enter a whole number of 0 or more." }).int("Enter a whole number of 0 or more.").min(0, "Enter a whole number of 0 or more.").max(MAX_STOCK, `Enter ${MAX_STOCK.toLocaleString("en-US")} or fewer.`),
  /** The on-hand count the editor started from; null for a new variant. */
  expectedStock: z.number().int().min(0).nullable(),
  mediaIds: z.array(z.string().max(64)).min(1, "Choose at least one photo for this variant.").max(MAX_MEDIA),
});

export const productInputSchema = z.strictObject({
  version: z.number().int().min(0),
  status: z.enum(productStatuses),
  name: text(100, "Enter a product name of 1–100 characters."),
  description: text(1200, "Enter a description of 1–1,200 characters."),
  details: z.array(text(120, "Keep each detail to 1–120 characters.")).max(8, "Keep up to 8 details."),
  category: z.enum(categories as [string, ...string[]], { error: "Choose a category." }),
  vendor: text(80, "Enter a seller name of 1–80 characters."),
  optionNames: z.array(text(24, "Name the option in 1–24 characters.")).min(1).max(MAX_OPTION_GROUPS),
  swatches: z.record(z.string().max(40), z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color.")),
  media: z.array(mediaInputSchema).min(1, "Choose at least one photo.").max(MAX_MEDIA, `Choose up to ${MAX_MEDIA} photos.`),
  variants: z.array(variantInputSchema).min(1, "Keep at least one variant.").max(MAX_VARIANTS, `Keep up to ${MAX_VARIANTS} variants.`),
}).superRefine((input, context) => {
  const lower = (value: string) => value.trim().toLowerCase();
  if (new Set(input.optionNames.map(lower)).size !== input.optionNames.length) {
    context.addIssue({ code: "custom", path: ["optionNames", 1], message: "Option names must be different." });
  }
  const mediaIds = new Set(input.media.map(item => item.id));
  if (mediaIds.size !== input.media.length || new Set(input.media.map(item => item.src)).size !== input.media.length) {
    context.addIssue({ code: "custom", path: ["media"], message: "Choose each photo only once." });
  }
  const combinations = new Map<string, number>();
  const skus = new Map<string, number>();
  input.variants.forEach((variant, index) => {
    if (variant.options.length !== input.optionNames.length) {
      context.addIssue({ code: "custom", path: ["variants", index, "options"], message: "Fill in every option for this variant." });
    }
    const combination = variant.options.map(lower).join("\u0000");
    if (combinations.has(combination)) {
      context.addIssue({ code: "custom", path: ["variants", index, "options"], message: "Another variant already uses these options." });
    } else combinations.set(combination, index);
    const sku = variant.sku.toUpperCase();
    if (skus.has(sku)) context.addIssue({ code: "custom", path: ["variants", index, "sku"], message: "Each variant needs a different SKU." });
    else skus.set(sku, index);
    if (variant.compareAtPrice !== null && variant.compareAtPrice <= variant.price) {
      context.addIssue({ code: "custom", path: ["variants", index, "compareAtPrice"], message: "A compare-at price must be higher than the price." });
    }
    if (variant.mediaIds.some(id => !mediaIds.has(id))) {
      context.addIssue({ code: "custom", path: ["variants", index, "mediaIds"], message: "Choose photos from this product." });
    }
  });
});

export type ProductInput = z.infer<typeof productInputSchema>;

/** Flattens Zod issues to `field.path` keys, keeping the first message per field. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    errors[key] ??= issue.message;
  }
  return errors;
}

export function slugify(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
  return slug || "product";
}

/** Parses a USD amount such as "28" or "28.50" into integer cents. */
export function parsePriceCents(value: string): number | null {
  const trimmed = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatPriceInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

const fallbackSwatch = "#8a8178";

/** Shapes a stored product for the storefront, which keeps the original `Product` contract. */
export function toStorefrontProduct(record: CatalogRecord): Product | null {
  const mediaIds = new Set(record.media.map(item => item.id));
  const variants: ProductVariant[] = record.variants.map(variant => {
    const ids = variant.mediaIds.filter(id => mediaIds.has(id));
    return {
      id: variant.id,
      sku: variant.sku,
      options: variant.options,
      price: variant.price,
      ...(variant.compareAtPrice !== null ? { compareAtPrice: variant.compareAtPrice } : {}),
      stock: Math.max(0, variant.onHand - variant.reserved),
      mediaIds: ids.length ? ids : record.media.slice(0, 1).map(item => item.id),
    };
  });
  const first = variants[0];
  if (!first || !record.media.length) return null;
  const optionGroups = record.optionNames.map(name => {
    const values: { name: string; value?: string }[] = [];
    for (const variant of variants) {
      const value = variant.options[name];
      if (value && !values.some(item => item.name === value)) {
        values.push(record.swatches[value] ? { name: value, value: record.swatches[value] } : { name: value });
      }
    }
    return { name, values };
  });
  const colorGroup = optionGroups.find(group => group.name.toLowerCase() === "color") ?? optionGroups[0];
  const cover = record.media.find(item => item.id === first.mediaIds[0]) ?? record.media[0];
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    category: record.category,
    price: first.price,
    ...(first.compareAtPrice !== undefined ? { compareAtPrice: first.compareAtPrice } : {}),
    color: first.options[record.optionNames[0]] ?? "",
    colors: colorGroup.values.map(value => ({ name: value.name, value: value.value ?? fallbackSwatch })),
    vendor: record.vendor,
    description: record.description,
    image: cover.src,
    imageAlt: cover.alt,
    details: record.details,
    stock: variants.reduce((sum, variant) => sum + variant.stock, 0),
    media: record.media,
    optionGroups,
    variants,
  };
}

/** Converts a sample/storefront product into editor input, used by the seed script. */
export function productToInput(product: Product, status: ProductStatus = "published"): ProductInput {
  const optionNames = product.optionGroups.map(group => group.name);
  const swatches: Record<string, string> = {};
  for (const group of product.optionGroups) for (const value of group.values) if (value.value) swatches[value.name] = value.value;
  return {
    version: 0,
    status,
    name: product.name,
    description: product.description,
    details: product.details,
    category: product.category,
    vendor: product.vendor,
    optionNames,
    swatches,
    media: product.media,
    variants: product.variants.map(variant => ({
      id: variant.id,
      options: optionNames.map(name => variant.options[name]),
      sku: variant.sku,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice ?? null,
      stock: variant.stock,
      expectedStock: null,
      mediaIds: variant.mediaIds,
    })),
  };
}
