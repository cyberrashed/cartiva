import { z } from "zod";
import { couponCodeSchema, type ShippingMethod } from "./checkout-settings.ts";
import { usStates } from "./seller-application.ts";

export { usStates };

export const MAX_CHECKOUT_LINES = 50;
export const MAX_LINE_QUANTITY = 99;
/** Stripe Checkout sessions live at least 30 minutes; the stock hold matches the session. */
export const RESERVATION_MINUTES = 30;

const lineSchema = z.strictObject({
  variantId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY, `Choose up to ${MAX_LINE_QUANTITY} of each item.`),
});
const linesSchema = z.array(lineSchema).min(1, "Your bag is empty.")
  .max(MAX_CHECKOUT_LINES, `Check out up to ${MAX_CHECKOUT_LINES} different items at a time.`);
const optionalCode = z.union([z.literal(""), couponCodeSchema]).nullable().optional()
  .transform(value => value ? value : null);

function uniqueLines(lines: { variantId: string }[], context: z.RefinementCtx) {
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    if (seen.has(line.variantId)) context.addIssue({ code: "custom", path: ["lines", index, "variantId"], message: "Each item may appear once." });
    seen.add(line.variantId);
  });
}

/** A price preview: no order, hold or payment is created. */
export const quoteInputSchema = z.strictObject({
  lines: linesSchema,
  state: z.enum(usStates, { error: "Choose a US state." }),
  couponCode: optionalCode,
  shippingMethodId: z.string().max(40).nullable().optional().transform(value => value ?? null),
}).superRefine((value, context) => uniqueLines(value.lines, context));
export type QuoteInput = z.infer<typeof quoteInputSchema>;

export const checkoutInputSchema = z.strictObject({
  checkoutKey: z.uuid("Refresh the page and try again."),
  shippingMethodId: z.string().min(1, "Choose how you'd like to get your order.").max(40),
  couponCode: optionalCode,
  /** The total the shopper last saw; the order is refused if the server's total differs. */
  expectedTotalCents: z.number().int().min(0),
  email: z.string().trim().toLowerCase().max(254, "Use 254 characters or fewer.")
    .pipe(z.email("Enter a valid email address.")),
  name: z.string().trim().min(2, "Enter the recipient's full name.").max(100, "Use 100 characters or fewer."),
  address: z.string().trim().min(4, "Enter a street address.").max(200, "Use 200 characters or fewer."),
  city: z.string().trim().min(2, "Enter a city.").max(100, "Use 100 characters or fewer."),
  state: z.enum(usStates, { error: "Choose a US state." }),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code or ZIP+4."),
  lines: linesSchema,
}).superRefine((value, context) => uniqueLines(value.lines, context));
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export type SellableVariant = {
  variantId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  priceCents: number;
  available: number;
  imageSrc: string | null;
};

export type PricedLine = SellableVariant & { quantity: number; lineTotalCents: number };
export type PricedOrder = { lines: PricedLine[]; subtotalCents: number };

export type CheckoutProblem = { variantId: string; reason: "unavailable" | "insufficient"; available: number; name?: string };

/**
 * Prices the merchandise from server-side catalog rows only. The browser sends
 * variant IDs and quantities, never prices. Delivery, discounts and tax are added
 * by `totalsFor` in checkout-settings.
 */
export function priceOrder(lines: CheckoutInput["lines"], variants: readonly SellableVariant[]): { order: PricedOrder; problems: CheckoutProblem[] } {
  const byId = new Map(variants.map(variant => [variant.variantId, variant]));
  const problems: CheckoutProblem[] = [];
  const priced: PricedLine[] = [];
  for (const line of lines) {
    const variant = byId.get(line.variantId);
    if (!variant) { problems.push({ variantId: line.variantId, reason: "unavailable", available: 0 }); continue; }
    if (variant.available < line.quantity) {
      problems.push({ variantId: line.variantId, reason: "insufficient", available: Math.max(0, variant.available), name: variant.productName });
      continue;
    }
    priced.push({ ...variant, quantity: line.quantity, lineTotalCents: variant.priceCents * line.quantity });
  }
  return { order: { lines: priced, subtotalCents: priced.reduce((sum, line) => sum + line.lineTotalCents, 0) }, problems };
}

export type QuoteDTO = {
  lines: { variantId: string; quantity: number; unitPriceCents: number; lineTotalCents: number }[];
  problems: CheckoutProblem[];
  coupon: { code: string; ok: boolean; message: string } | null;
  methods: ShippingMethod[];
  selectedMethodId: string | null;
  /** Shown when nothing ships to the chosen state. */
  shippingMessage: string | null;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

export type OrderShippingMethod = Pick<ShippingMethod, "id" | "kind" | "name" | "priceCents" | "minDays" | "maxDays" | "address" | "instructions">;

export type OrderStatus = "pending_payment" | "placed" | "canceled";
export type PaymentStatus = "awaiting" | "paid" | "expired" | "failed";
export type FulfillmentStatus = "unfulfilled";

export const orderStatusLabels: Record<OrderStatus, string> = {
  pending_payment: "Holding stock",
  placed: "Placed",
  canceled: "Canceled",
};
export const paymentStatusLabels: Record<PaymentStatus, string> = {
  awaiting: "Awaiting payment",
  paid: "Paid",
  expired: "Checkout expired",
  failed: "Payment failed",
};
export const fulfillmentStatusLabels: Record<FulfillmentStatus, string> = {
  unfulfilled: "Not shipped yet",
};

export type OrderLineDTO = {
  variantId: string;
  productId: string | null;
  productName: string;
  variantLabel: string;
  sku: string;
  imageSrc: string | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
};

export type OrderDTO = {
  id: string;
  number: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  email: string;
  shipping: { name: string; address: string; city: string; state: string; zip: string; country: "US" };
  lines: OrderLineDTO[];
  subtotalCents: number;
  discountCents: number;
  couponCode: string | null;
  shippingMethod: OrderShippingMethod | null;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  createdAt: string;
  placedAt: string | null;
  canceledAt: string | null;
  reviewReason: string | null;
};

/** What the confirmation page may show to whoever holds the Stripe session id. */
export type CheckoutStatusDTO = {
  number: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  email: string;
  lines: Pick<OrderLineDTO, "productName" | "variantLabel" | "sku" | "quantity" | "lineTotalCents" | "imageSrc">[];
  subtotalCents: number;
  discountCents: number;
  couponCode: string | null;
  shippingMethod: OrderShippingMethod | null;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

/** Guest order lookup by number and email. The street address is left out. */
export type OrderLookupDTO = Omit<CheckoutStatusDTO, "email"> & {
  placedAt: string | null;
  fulfillmentStatus: FulfillmentStatus;
  destination: string;
};

export const orderLookupSchema = z.strictObject({
  number: z.string().trim().toUpperCase().regex(/^CV-\d{1,12}$/, "Enter the order number, like CV-2001."),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter the email used at checkout.")),
});

export type CheckoutStartResult =
  | { kind: "redirect"; url: string; number: string }
  | { kind: "paid"; number: string };
