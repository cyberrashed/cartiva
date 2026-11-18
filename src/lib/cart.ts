import type { ProductVariant } from "./catalog";

export interface CartLine {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface CartProduct {
  id: string;
  variants: readonly Pick<ProductVariant, "id" | "price" | "stock" | "options">[];
}

function storedVariant(entry: Record<string, unknown>, product: CartProduct) {
  // An explicit but invalid ID must never silently select another SKU.
  if ("variantId" in entry) return product.variants.find(variant => variant.id === entry.variantId);
  if (typeof entry.color !== "string") return;
  const matches = product.variants.filter(variant => variant.options.Color === entry.color);
  if (matches.length === 1) return matches[0];
  // Previous carts sold individual products. A color with multiple set sizes
  // migrates only when one Single SKU makes the old choice unambiguous.
  const singles = matches.filter(variant => variant.options.Set === "Single");
  if (singles.length === 1) return singles[0];
}

export function sanitizeCart(
  value: unknown,
  products: readonly CartProduct[],
): CartLine[] {
  if (!Array.isArray(value)) return [];

  const catalog = new Map(products.map((product) => [product.id, product]));
  const result: CartLine[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { productId, quantity } = entry;
    const product = catalog.get(productId);

    if (
      !product ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0
    ) {
      continue;
    }

    const variant = storedVariant(entry, product);
    if (!variant) continue;
    const existing = result.find(
      (line) => line.productId === productId && line.variantId === variant.id,
    );
    const accepted = Math.min(quantity, Math.max(0, variant.stock - (existing?.quantity ?? 0)));
    if (accepted <= 0) continue;
    if (existing) existing.quantity += accepted;
    else result.push({ productId, variantId: variant.id, quantity: accepted });
  }

  return result;
}

export function updateCart(
  lines: readonly CartLine[],
  product: CartProduct,
  variantId: string,
  quantity: number,
): CartLine[] {
  const variant = product.variants.find(item => item.id === variantId);
  if (!Number.isSafeInteger(quantity) || !variant) {
    return [...lines];
  }

  const matches = (line: CartLine) =>
    line.productId === product.id && line.variantId === variantId;
  const position = lines.findIndex(matches);
  const result = lines.filter((line) => !matches(line));
  const accepted = Math.min(quantity, Math.max(0, variant.stock));

  if (accepted > 0) {
    result.splice(position < 0 ? result.length : position, 0, {
      productId: product.id,
      quantity: accepted,
      variantId,
    });
  }

  return result;
}

export function subtotal(
  lines: readonly CartLine[],
  products: readonly CartProduct[],
): number {
  const catalog = new Map(products.map((product) => [product.id, product]));
  return sanitizeCart(lines, products).reduce(
    (total, line) => total + (catalog.get(line.productId)?.variants.find(variant => variant.id === line.variantId)?.price ?? 0) * line.quantity,
    0,
  );
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function money(cents: number): string {
  return usd.format(cents / 100);
}
