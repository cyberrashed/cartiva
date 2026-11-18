import { mediaLibrary, type ProductMedia } from "./catalog.ts";
import {
  formatPriceInput, parsePriceCents, productInputSchema, fieldErrorsFrom,
  type AdminProduct, type ProductInput, type ProductStatus,
} from "./catalog-admin.ts";

/** Editable text fields for one variant; numbers stay strings until validation. */
export type EditorVariant = {
  key: string;
  id?: string;
  options: string[];
  sku: string;
  price: string;
  compareAt: string;
  stock: string;
  /** On-hand count when the product was loaded; null for unsaved variants. */
  expectedStock: number | null;
  mediaIds: string[];
};

export type EditorState = {
  id?: string;
  slug: string;
  version: number;
  status: ProductStatus;
  name: string;
  description: string;
  details: string;
  category: string;
  vendor: string;
  optionNames: string[];
  swatches: Record<string, string>;
  media: ProductMedia[];
  variants: EditorVariant[];
};

export function editorFromProduct(product: AdminProduct): EditorState {
  return {
    id: product.id,
    slug: product.slug,
    version: product.version,
    status: product.status,
    name: product.name,
    description: product.description,
    details: product.details.join("\n"),
    category: product.category,
    vendor: product.vendor,
    optionNames: [...product.optionNames],
    swatches: { ...product.swatches },
    media: product.media.map(item => ({ ...item })),
    variants: product.variants.map(variant => ({
      key: variant.id,
      id: variant.id,
      options: [...variant.options],
      sku: variant.sku,
      price: formatPriceInput(variant.price),
      compareAt: formatPriceInput(variant.compareAtPrice),
      stock: String(variant.stock),
      expectedStock: variant.stock,
      mediaIds: [...variant.mediaIds],
    })),
  };
}

export function emptyEditor(category: string): EditorState {
  return {
    slug: "",
    version: 0,
    status: "draft",
    name: "",
    description: "",
    details: "",
    category,
    vendor: "",
    optionNames: ["Color"],
    swatches: {},
    media: [],
    variants: [newVariant("new-1", 1, [])],
  };
}

export function newVariant(key: string, optionCount: number, mediaIds: string[]): EditorVariant {
  return { key, options: Array.from({ length: optionCount }, () => ""), sku: "", price: "", compareAt: "", stock: "0", expectedStock: null, mediaIds };
}

/** Media item for a library photo, keeping an existing item's ID/text when the same photo is already used. */
export function mediaForLibraryImage(current: ProductMedia[], libraryId: string): ProductMedia | null {
  const image = mediaLibrary.find(item => item.id === libraryId);
  if (!image) return null;
  return current.find(item => item.src === image.src) ?? { id: image.id, src: image.src, alt: image.alt, label: image.label };
}

function numberOrNaN(value: string, parse: (text: string) => number | null) {
  const parsed = parse(value);
  return parsed === null ? Number.NaN : parsed;
}

/** Converts editor text into the API input (unvalidated). */
export function editorToInput(state: EditorState): unknown {
  return {
    version: state.version,
    status: state.status,
    name: state.name,
    description: state.description,
    details: state.details.split("\n").map(line => line.trim()).filter(Boolean),
    category: state.category,
    vendor: state.vendor,
    optionNames: state.optionNames.map(name => name.trim()),
    swatches: Object.fromEntries(Object.entries(state.swatches).filter(([value]) =>
      state.variants.some(variant => variant.options.some(option => option.trim() === value)))),
    media: state.media,
    variants: state.variants.map(variant => ({
      ...(variant.id ? { id: variant.id } : {}),
      options: variant.options.map(option => option.trim()),
      sku: variant.sku,
      price: numberOrNaN(variant.price, parsePriceCents),
      compareAtPrice: variant.compareAt.trim() ? numberOrNaN(variant.compareAt, parsePriceCents) : null,
      stock: numberOrNaN(variant.stock, text => /^\s*\d+\s*$/.test(text) ? Number(text) : null),
      expectedStock: variant.expectedStock,
      mediaIds: variant.mediaIds,
    })),
  };
}

export function validateEditor(state: EditorState): { input?: ProductInput; errors: Record<string, string> } {
  const result = productInputSchema.safeParse(editorToInput(state));
  return result.success ? { input: result.data, errors: {} } : { errors: fieldErrorsFrom(result.error) };
}

/** Values of the option named "Color" (case-insensitive), in variant order. */
export function colorValues(state: EditorState): string[] {
  const index = state.optionNames.findIndex(name => name.trim().toLowerCase() === "color");
  if (index < 0) return [];
  return [...new Set(state.variants.map(variant => variant.options[index]?.trim()).filter((value): value is string => Boolean(value)))];
}
