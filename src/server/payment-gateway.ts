import "server-only";
import Stripe from "stripe";

/** The payment state Cartiva needs from a provider checkout, read from the provider itself. */
export type CheckoutSnapshot = {
  id: string;
  status: "open" | "complete" | "expired";
  paymentStatus: "paid" | "unpaid" | "no_payment_required";
  amountTotal: number | null;
  currency: string | null;
  orderId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  /** Provider fee once the balance transaction exists; null when not known yet. */
  feeCents: number | null;
};

export type CheckoutRequest = {
  orderId: string;
  number: string;
  email: string;
  expiresAt: Date;
  shipping: { name: string; priceCents: number; minDays: number | null; maxDays: number | null };
  /** A one-off amount off the merchandise, shown by Stripe as the shopper's code. */
  discount: { code: string; amountCents: number } | null;
  lines: { name: string; description: string; unitPriceCents: number; quantity: number }[];
  successUrl: string;
  cancelUrl: string;
};

export interface PaymentGateway {
  /** `couponId` is the provider's one-off coupon for a discounted order, kept for reconciliation. */
  createCheckout(request: CheckoutRequest): Promise<{ id: string; url: string; couponId: string | null }>;
  retrieveCheckout(sessionId: string): Promise<CheckoutSnapshot>;
  /** Expires the checkout if it is still open and returns its state afterwards. */
  expireCheckout(sessionId: string): Promise<CheckoutSnapshot>;
}

export class PaymentUnavailableError extends Error {}

let override: PaymentGateway | null = null;
let client: Stripe | null = null;

/** Integration tests replace Stripe with a recorded fake; production code never calls this. */
export function setPaymentGatewayForTests(gateway: PaymentGateway | null) {
  override = gateway;
}

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new PaymentUnavailableError("Stripe is not configured. Add STRIPE_SECRET_KEY to .env.local.");
  // This build is a sandbox. Refuse live keys so no real card can ever be charged.
  if (!key.startsWith("sk_test_")) throw new PaymentUnavailableError("Only Stripe sandbox keys (sk_test_…) are accepted.");
  client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "Cartiva" } });
  return client;
}

function snapshot(session: Stripe.Checkout.Session): CheckoutSnapshot {
  const intent = session.payment_intent && typeof session.payment_intent === "object" ? session.payment_intent : null;
  const charge = intent?.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const balance = charge?.balance_transaction && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
  return {
    id: session.id,
    status: session.status === "complete" ? "complete" : session.status === "expired" ? "expired" : "open",
    paymentStatus: session.payment_status === "paid" ? "paid" : session.payment_status === "no_payment_required" ? "no_payment_required" : "unpaid",
    amountTotal: session.amount_total,
    currency: session.currency,
    orderId: session.metadata?.order_id ?? session.client_reference_id ?? null,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : intent?.id ?? null,
    chargeId: charge?.id ?? (typeof intent?.latest_charge === "string" ? intent.latest_charge : null),
    feeCents: balance ? balance.fee : null,
  };
}

async function retrieveStripeCheckout(sessionId: string) {
  return snapshot(await stripe().checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent.latest_charge.balance_transaction"],
  }));
}

const stripeGateway: PaymentGateway = {
  async createCheckout(request) {
    const metadata = { order_id: request.orderId, order_number: request.number };
    // Stripe line items can't be negative, so a code becomes a single-use Stripe coupon
    // for exactly the amount Cartiva calculated.
    const discount = request.discount && request.discount.amountCents > 0
      ? await stripe().coupons.create({
        amount_off: request.discount.amountCents, currency: "usd", duration: "once", max_redemptions: 1,
        name: request.discount.code.slice(0, 40), metadata,
      }, { idempotencyKey: `cartiva-coupon-${request.orderId}` })
      : null;
    // Stripe estimates need positive day counts; same-day options show no estimate.
    const minDays = request.shipping.minDays ? request.shipping.minDays : null;
    const maxDays = request.shipping.maxDays ? request.shipping.maxDays : null;
    const session = await stripe().checkout.sessions.create({
      // Payment methods follow the Stripe Dashboard settings. Delayed methods are
      // handled through the async_payment_* webhook events.
      mode: "payment",
      client_reference_id: request.orderId,
      customer_email: request.email,
      line_items: request.lines.map(line => ({
        quantity: line.quantity,
        price_data: {
          currency: "usd",
          unit_amount: line.unitPriceCents,
          product_data: { name: line.name, description: line.description },
        },
      })),
      shipping_options: [{
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: request.shipping.name,
          fixed_amount: { amount: request.shipping.priceCents, currency: "usd" },
          ...(minDays !== null || maxDays !== null ? {
            delivery_estimate: {
              ...(minDays !== null ? { minimum: { unit: "business_day" as const, value: minDays } } : {}),
              ...(maxDays !== null ? { maximum: { unit: "business_day" as const, value: maxDays } } : {}),
            },
          } : {}),
        },
      }],
      ...(discount ? { discounts: [{ coupon: discount.id }] } : {}),
      metadata,
      payment_intent_data: { metadata, description: `Cartiva order ${request.number}` },
      expires_at: Math.floor(request.expiresAt.getTime() / 1000),
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    }, { idempotencyKey: `cartiva-checkout-${request.orderId}` });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return { id: session.id, url: session.url, couponId: discount?.id ?? null };
  },
  retrieveCheckout: retrieveStripeCheckout,
  async expireCheckout(sessionId) {
    const current = await retrieveStripeCheckout(sessionId);
    if (current.status !== "open") return current;
    try {
      await stripe().checkout.sessions.expire(sessionId);
    } catch (error) {
      // The customer may have completed payment at the same moment; re-read below.
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error;
    }
    return retrieveStripeCheckout(sessionId);
  },
};

export function paymentGateway(): PaymentGateway {
  return override ?? stripeGateway;
}

export function paymentsConfigured(): boolean {
  return Boolean(override) || Boolean(process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"));
}

/** Throws when the signature does not match the raw body. */
export function verifyStripeWebhook(payload: string, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(payload, signature, secret);
}
