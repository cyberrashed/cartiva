import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import type Stripe from "stripe";
import {
  priceOrder, RESERVATION_MINUTES,
  type CheckoutInput, type CheckoutProblem, type CheckoutStartResult, type CheckoutStatusDTO,
  type OrderDTO, type OrderLookupDTO, type OrderShippingMethod, type PaymentStatus, type QuoteDTO, type QuoteInput, type SellableVariant,
} from "../lib/checkout";
import { evaluateCoupon, shippingMethodsFor, totalsFor, type CouponOutcome, type Totals } from "../lib/checkout-settings";
import { money } from "../lib/cart";
import { invalidateCatalog } from "./catalog-cache";
import { couponRule, loadShippingSettings } from "./checkout-settings";
import { db } from "./db";
import { isUniqueViolation } from "./db-errors";
import { paymentGateway, paymentsConfigured, type CheckoutSnapshot } from "./payment-gateway";
import {
  auditEvent, catalogProduct, catalogVariant, coupon, couponRedemption, customerOrder, customerOrderLine, inventoryBalance,
  ledgerJournal, ledgerLine, outboxEvent, stockMovement, webhookEvent, type ledgerAccounts,
} from "./schema";

/** Why a checkout was refused, for the browser to show next to the right control. */
type OrderErrorCode = "coupon" | "shipping" | "total_changed" | "minimum";

export class OrderError extends Error {
  constructor(
    public status: number,
    message: string,
    public problems?: CheckoutProblem[],
    public extra?: { code?: OrderErrorCode; fieldErrors?: Record<string, string>; totals?: Totals },
  ) {
    super(message);
  }
}

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];
type OrderRow = typeof customerOrder.$inferSelect;
type LineRow = typeof customerOrderLine.$inferSelect;

/** Expired holds are released a little after the provider's own expiry. */
const RELEASE_GRACE_MS = 2 * 60_000;
/** A held checkout with less time than this left is replaced rather than resumed. */
const MIN_RESUME_MS = 5 * 60_000;
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{8,240}$/;

function requestHash(input: CheckoutInput, userId: string | null) {
  const lines = [...input.lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
  const { email, name, address, city, state, zip, shippingMethodId, couponCode } = input;
  return createHash("sha256").update(JSON.stringify({ userId, email, name, address, city, state, zip, shippingMethodId, couponCode, lines })).digest("hex");
}

function problemMessage(problems: CheckoutProblem[]) {
  return problems.some(problem => problem.reason === "unavailable")
    ? "Some items in your bag are no longer available. Review your bag and try again."
    : "Some items in your bag have fewer pieces left than you chose. Review your bag and try again.";
}

/**
 * Published, non-archived variants with their balances. Inside an order transaction
 * the balances are locked in a stable order (balances before coupons, everywhere).
 */
async function sellableVariants(executor: Executor | typeof db, variantIds: string[], lock: boolean): Promise<SellableVariant[]> {
  if (!variantIds.length) return [];
  const query = executor.select({
    variant: catalogVariant, productName: catalogProduct.name, media: catalogProduct.media,
    onHand: inventoryBalance.onHand, reserved: inventoryBalance.reserved,
  })
    .from(catalogVariant)
    .innerJoin(catalogProduct, eq(catalogProduct.id, catalogVariant.productId))
    .innerJoin(inventoryBalance, eq(inventoryBalance.variantId, catalogVariant.id))
    .where(and(inArray(catalogVariant.id, variantIds), eq(catalogVariant.archived, false), eq(catalogProduct.status, "published")))
    .orderBy(asc(catalogVariant.id));
  const rows = lock ? await query.for("update", { of: inventoryBalance }) : await query;
  return rows.map(row => {
    const image = row.variant.mediaIds.map(id => row.media.find(item => item.id === id)).find(Boolean) ?? row.media[0];
    return {
      variantId: row.variant.id, productId: row.variant.productId, productName: row.productName,
      variantLabel: Object.values(row.variant.options).join(" · ") || "Standard", sku: row.variant.sku,
      priceCents: row.variant.priceCents, available: row.onHand - row.reserved, imageSrc: image?.src ?? null,
    };
  });
}

async function linesFor(orderIds: string[], executor: Pick<typeof db, "select"> = db): Promise<Map<string, LineRow[]>> {
  const grouped = new Map<string, LineRow[]>();
  if (!orderIds.length) return grouped;
  const rows = await executor.select().from(customerOrderLine).where(inArray(customerOrderLine.orderId, orderIds))
    .orderBy(asc(customerOrderLine.position));
  for (const row of rows) grouped.set(row.orderId, [...grouped.get(row.orderId) ?? [], row]);
  return grouped;
}

type PricingRequest = Pick<CheckoutInput, "lines" | "state" | "couponCode"> & { shippingMethodId: string | null };

/**
 * The one pricing path for previews and orders: database prices, the code, the
 * delivery options for the state and the totals. With `lock`, stock balances and the
 * coupon row are locked for the order transaction.
 */
async function priceCheckout(executor: Executor | typeof db, request: PricingRequest, options: { lock: boolean; fallbackMethod: boolean }) {
  const variants = await sellableVariants(executor, request.lines.map(line => line.variantId), options.lock);
  const { order: priced, problems } = priceOrder(request.lines, variants);
  const settings = await loadShippingSettings(executor);
  let couponRow: typeof coupon.$inferSelect | undefined;
  let couponOutcome: CouponOutcome | null = null;
  if (request.couponCode) {
    const query = executor.select().from(coupon).where(eq(coupon.code, request.couponCode));
    [couponRow] = options.lock ? await query.for("update") : await query;
    couponOutcome = evaluateCoupon(couponRow ? couponRule(couponRow) : null, request.couponCode, priced.subtotalCents, new Date());
  }
  const discountCents = couponOutcome?.ok ? couponOutcome.discountCents : 0;
  const freeShipping = couponOutcome?.ok ? couponOutcome.freeShipping : false;
  const methods = shippingMethodsFor(settings.config, request.state, priced.subtotalCents - discountCents, freeShipping);
  const method = methods.find(item => item.id === request.shippingMethodId) ?? (options.fallbackMethod ? methods[0] ?? null : null);
  return { priced, problems, couponRow, couponOutcome, methods, method, totals: totalsFor(priced.subtotalCents, discountCents, method) };
}

function noDeliveryMessage(state: string) {
  return `We don't deliver to ${state} yet. Use another address, or contact us about your order.`;
}

/** A price preview for the review step. Creates nothing and holds nothing. */
export async function quoteCheckout(input: QuoteInput): Promise<QuoteDTO> {
  const result = await priceCheckout(db, input, { lock: false, fallbackMethod: true });
  return {
    lines: result.priced.lines.map(line => ({ variantId: line.variantId, quantity: line.quantity, unitPriceCents: line.priceCents, lineTotalCents: line.lineTotalCents })),
    problems: result.problems,
    coupon: result.couponOutcome
      ? { code: result.couponOutcome.code, ok: result.couponOutcome.ok, message: result.couponOutcome.ok ? `${result.couponOutcome.label} applied.` : result.couponOutcome.message }
      : null,
    methods: result.methods,
    selectedMethodId: result.method?.id ?? null,
    shippingMessage: result.methods.length ? null : noDeliveryMessage(input.state),
    ...result.totals,
  };
}

async function createOrder(input: CheckoutInput, userId: string | null, hash: string): Promise<OrderRow> {
  const order = await db.transaction(async tx => {
    const { priced, problems, couponRow, couponOutcome, methods, method, totals } = await priceCheckout(tx, input, { lock: true, fallbackMethod: false });
    if (problems.length) throw new OrderError(409, problemMessage(problems), problems);
    if (couponOutcome && !couponOutcome.ok) {
      throw new OrderError(409, couponOutcome.message, undefined, { code: "coupon", fieldErrors: { couponCode: couponOutcome.message } });
    }
    if (!method) {
      const message = methods.length ? "That delivery option isn't available for your address. Choose another." : noDeliveryMessage(input.state);
      throw new OrderError(409, message, undefined, { code: "shipping" });
    }
    // Stripe card payments in USD need at least $0.50 (a 100% code with pickup would be $0).
    if (totals.totalCents < 50) {
      throw new OrderError(409, "Orders paid by card must total at least $0.50.", undefined, { code: "minimum" });
    }
    // The shopper confirms the total they saw; any change must be shown before paying.
    if (totals.totalCents !== input.expectedTotalCents) {
      throw new OrderError(409, `Your total is now ${money(totals.totalCents)}. Review it before paying.`, undefined, { code: "total_changed", totals });
    }
    const now = new Date();
    // Provider sessions must live at least 30 minutes; the margin absorbs clock skew.
    const expiresAt = new Date(now.getTime() + RESERVATION_MINUTES * 60_000 + 90_000);
    const { rows } = await tx.execute<{ value: string }>(sql`SELECT nextval('customer_order_number_seq')::text AS value`);
    const id = randomUUID();
    const shippingMethod: OrderShippingMethod = {
      id: method.id, kind: method.kind, name: method.name, priceCents: method.priceCents,
      minDays: method.minDays, maxDays: method.maxDays, address: method.address, instructions: method.instructions,
    };
    const [created] = await tx.insert(customerOrder).values({
      id, number: `CV-${rows[0].value}`, checkoutKey: input.checkoutKey, requestHash: hash, userId, email: input.email,
      shipping: { name: input.name, address: input.address, city: input.city, state: input.state, zip: input.zip, country: "US" },
      subtotalCents: totals.subtotalCents, discountCents: totals.discountCents, couponCode: couponOutcome?.ok ? couponOutcome.code : null,
      shippingMethod, shippingCents: totals.shippingCents, taxCents: totals.taxCents, totalCents: totals.totalCents,
      reservationExpiresAt: expiresAt,
    }).returning();
    if (couponRow && couponOutcome?.ok) {
      // Held like stock: counted against the limit now, released if the checkout ends unpaid.
      const [held] = await tx.update(coupon).set({ usedCount: sql`${coupon.usedCount} + 1`, updatedAt: now })
        .where(and(eq(coupon.id, couponRow.id), sql`(${coupon.usageLimit} IS NULL OR ${coupon.usedCount} < ${coupon.usageLimit})`))
        .returning({ id: coupon.id });
      if (!held) throw new OrderError(409, "This code has reached its limit.", undefined, { code: "coupon", fieldErrors: { couponCode: "This code has reached its limit." } });
      await tx.insert(couponRedemption).values({ id: randomUUID(), couponId: couponRow.id, orderId: id, status: "held", discountCents: totals.discountCents });
    }
    await tx.insert(customerOrderLine).values(priced.lines.map((line, position) => ({
      id: randomUUID(), orderId: id, position, productId: line.productId, variantId: line.variantId, sku: line.sku,
      productName: line.productName, variantLabel: line.variantLabel, imageSrc: line.imageSrc,
      unitPriceCents: line.priceCents, quantity: line.quantity, lineTotalCents: line.lineTotalCents,
    })));
    for (const line of [...priced.lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      // Conditional and atomic: the hold succeeds only while enough stock is free.
      const [held] = await tx.update(inventoryBalance)
        .set({ reserved: sql`${inventoryBalance.reserved} + ${line.quantity}`, updatedAt: now })
        .where(and(eq(inventoryBalance.variantId, line.variantId), sql`${inventoryBalance.onHand} - ${inventoryBalance.reserved} >= ${line.quantity}`))
        .returning({ variantId: inventoryBalance.variantId });
      if (!held) {
        const problem: CheckoutProblem = { variantId: line.variantId, reason: "insufficient", available: 0, name: line.productName };
        throw new OrderError(409, problemMessage([problem]), [problem]);
      }
    }
    await tx.insert(auditEvent).values({ id: randomUUID(), actorId: userId ?? "guest", action: "order.created", subjectId: id });
    return created;
  });
  invalidateCatalog();
  return order;
}

/** Cancels a pending order and releases its held stock. Returns false if it was not pending. */
async function cancelPendingOrder(orderId: string, paymentStatus: Exclude<PaymentStatus, "awaiting" | "paid">, reason: string): Promise<boolean> {
  const canceled = await db.transaction(async tx => {
    const [order] = await tx.select().from(customerOrder).where(eq(customerOrder.id, orderId)).for("update");
    if (!order || order.status !== "pending_payment") return false;
    const lines = (await linesFor([order.id], tx)).get(order.id) ?? [];
    const now = new Date();
    for (const line of [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      await tx.update(inventoryBalance)
        .set({ reserved: sql`${inventoryBalance.reserved} - ${line.quantity}`, updatedAt: now })
        .where(and(eq(inventoryBalance.variantId, line.variantId), gte(inventoryBalance.reserved, line.quantity)));
    }
    const [released] = await tx.update(couponRedemption).set({ status: "released", updatedAt: now })
      .where(and(eq(couponRedemption.orderId, order.id), eq(couponRedemption.status, "held"))).returning();
    if (released) {
      await tx.update(coupon).set({ usedCount: sql`${coupon.usedCount} - 1`, updatedAt: now })
        .where(and(eq(coupon.id, released.couponId), gt(coupon.usedCount, 0)));
    }
    await tx.update(customerOrder).set({ status: "canceled", paymentStatus, checkoutKey: null, canceledAt: now, updatedAt: now })
      .where(eq(customerOrder.id, order.id));
    await tx.insert(auditEvent).values({ id: randomUUID(), actorId: "system", action: `order.canceled.${reason}`, subjectId: order.id });
    return true;
  });
  if (canceled) invalidateCatalog();
  return canceled;
}

type JournalLine = { account: (typeof ledgerAccounts)[number]; debit?: number; credit?: number };

/** Posts a balanced journal once per (kind, sourceRef). Unbalanced journals are refused. */
async function postJournal(tx: Executor, journal: { kind: string; sourceRef: string; orderId: string; memo: string; lines: JournalLine[] }) {
  const lines = journal.lines.filter(line => (line.debit ?? 0) > 0 || (line.credit ?? 0) > 0);
  const debits = lines.reduce((sum, line) => sum + (line.debit ?? 0), 0);
  const credits = lines.reduce((sum, line) => sum + (line.credit ?? 0), 0);
  if (debits !== credits || debits === 0) throw new Error(`Refusing an unbalanced ${journal.kind} journal.`);
  const [created] = await tx.insert(ledgerJournal)
    .values({ id: randomUUID(), kind: journal.kind, sourceRef: journal.sourceRef, orderId: journal.orderId, memo: journal.memo })
    .onConflictDoNothing({ target: [ledgerJournal.kind, ledgerJournal.sourceRef] })
    .returning({ id: ledgerJournal.id });
  if (!created) return false;
  await tx.insert(ledgerLine).values(lines.map(line => ({
    id: randomUUID(), journalId: created.id, account: line.account, debitCents: line.debit ?? 0, creditCents: line.credit ?? 0,
  })));
  return true;
}

/**
 * Applies a provider-verified, completed checkout exactly once: converts the hold into
 * a sale with stock movements, places the order, posts the ledger and queues the
 * confirmation. Safe to call again from the webhook, the confirmation page or the sweeper.
 */
export async function confirmPaidCheckout(snapshot: CheckoutSnapshot, source: "webhook" | "status_check" | "sweeper"): Promise<OrderRow | null> {
  if (snapshot.status !== "complete" || snapshot.paymentStatus === "unpaid") return null;
  const order = await db.transaction(async tx => {
    let [order] = await tx.select().from(customerOrder).where(eq(customerOrder.stripeCheckoutSessionId, snapshot.id)).for("update");
    // The session id may not be stored yet if the process stopped right after creating it.
    if (!order && snapshot.orderId) [order] = await tx.select().from(customerOrder).where(eq(customerOrder.id, snapshot.orderId)).for("update");
    if (!order) return null;
    const now = new Date();
    if (order.paymentStatus !== "paid") {
      const lines = (await linesFor([order.id], tx)).get(order.id) ?? [];
      const wasHeld = order.status === "pending_payment";
      const review: string[] = wasHeld ? [] : ["Payment arrived after this checkout had been canceled."];
      if (snapshot.amountTotal !== order.totalCents || snapshot.currency !== order.currency) {
        review.push(`Stripe reported ${snapshot.amountTotal ?? "no amount"} ${snapshot.currency ?? ""}; the order total is ${order.totalCents} ${order.currency}.`);
      }
      for (const line of [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
        // A held order consumes its own reservation; a released one needs free stock again.
        const condition = wasHeld
          ? gte(inventoryBalance.reserved, line.quantity)
          : sql`${inventoryBalance.onHand} - ${inventoryBalance.reserved} >= ${line.quantity}`;
        const [balance] = await tx.update(inventoryBalance).set({
          onHand: sql`${inventoryBalance.onHand} - ${line.quantity}`,
          reserved: wasHeld ? sql`${inventoryBalance.reserved} - ${line.quantity}` : inventoryBalance.reserved,
          updatedAt: now,
        }).where(and(eq(inventoryBalance.variantId, line.variantId), condition)).returning({ onHand: inventoryBalance.onHand });
        if (!balance) { review.push(`Stock for ${line.sku} could not be taken; check before shipping.`); continue; }
        await tx.insert(stockMovement).values({
          id: randomUUID(), variantId: line.variantId, delta: -line.quantity, balanceAfter: balance.onHand,
          reason: "sale", actorId: null, orderId: order.id,
        });
      }
      const [redemption] = await tx.select().from(couponRedemption).where(eq(couponRedemption.orderId, order.id)).for("update");
      if (redemption && redemption.status !== "redeemed") {
        if (redemption.status === "released") {
          // The code was released with the canceled checkout; count it again if it still fits.
          const [retaken] = await tx.update(coupon).set({ usedCount: sql`${coupon.usedCount} + 1`, updatedAt: now })
            .where(and(eq(coupon.id, redemption.couponId), sql`(${coupon.usageLimit} IS NULL OR ${coupon.usedCount} < ${coupon.usageLimit})`))
            .returning({ id: coupon.id });
          if (!retaken) review.push(`Code ${order.couponCode} was already at its limit when this late payment arrived.`);
        }
        await tx.update(couponRedemption).set({ status: "redeemed", updatedAt: now }).where(eq(couponRedemption.id, redemption.id));
      }
      [order] = await tx.update(customerOrder).set({
        status: "placed", paymentStatus: "paid", placedAt: now, canceledAt: null, updatedAt: now,
        stripeCheckoutSessionId: snapshot.id, stripePaymentIntentId: snapshot.paymentIntentId,
        reviewReason: review.length ? review.join(" ") : null,
      }).where(eq(customerOrder.id, order.id)).returning();
      await postJournal(tx, {
        kind: "order_payment", sourceRef: snapshot.id, orderId: order.id, memo: `Card payment for order ${order.number}`,
        lines: [
          { account: "stripe_receivable", debit: order.totalCents },
          // Discounts are contra-revenue: sales stay at list price and the code is visible.
          { account: "sales_discounts", debit: order.discountCents },
          { account: "sales_revenue", credit: order.subtotalCents },
          { account: "shipping_revenue", credit: order.shippingCents },
          { account: "sales_tax_payable", credit: order.taxCents },
        ],
      });
      await tx.insert(outboxEvent).values({
        id: randomUUID(), topic: "order.placed", aggregateId: order.id,
        payload: { orderId: order.id, number: order.number, email: order.email, totalCents: order.totalCents },
      }).onConflictDoNothing();
      await tx.insert(auditEvent).values({ id: randomUUID(), actorId: `system:${source}`, action: "order.paid", subjectId: order.id });
    }
    // The processing fee is known once Stripe has a balance transaction; post it once.
    if (snapshot.feeCents && snapshot.chargeId) {
      await postJournal(tx, {
        kind: "payment_fee", sourceRef: snapshot.chargeId, orderId: order.id, memo: `Stripe fee for order ${order.number}`,
        lines: [
          { account: "payment_processing_fees", debit: snapshot.feeCents },
          { account: "stripe_receivable", credit: snapshot.feeCents },
        ],
      });
    }
    return order;
  });
  invalidateCatalog();
  return order;
}

async function orderBySession(sessionId: string) {
  const [order] = await db.select().from(customerOrder).where(eq(customerOrder.stripeCheckoutSessionId, sessionId)).limit(1);
  return order ?? null;
}

/**
 * Ends a pending checkout: expires it at the provider first so it can no longer be
 * paid, then releases the hold. If the provider says it was paid, the order is placed.
 */
async function settleStaleOrder(order: OrderRow): Promise<"paid" | "canceled"> {
  if (order.stripeCheckoutSessionId) {
    const state = await paymentGateway().expireCheckout(order.stripeCheckoutSessionId);
    if (state.status === "complete" && state.paymentStatus !== "unpaid") {
      await confirmPaidCheckout(state, "sweeper");
      return "paid";
    }
    if (state.status === "complete") throw new OrderError(409, "This payment is still processing.");
  }
  await cancelPendingOrder(order.id, "expired", "expired");
  return "canceled";
}

/** Releases holds whose checkout expired. Leaves a hold in place if the provider cannot be reached. */
export async function releaseExpiredReservations(limit = 10): Promise<number> {
  const stale = await db.select().from(customerOrder)
    .where(and(eq(customerOrder.status, "pending_payment"), lt(customerOrder.reservationExpiresAt, new Date(Date.now() - RELEASE_GRACE_MS))))
    .orderBy(asc(customerOrder.reservationExpiresAt)).limit(limit);
  let released = 0;
  for (const order of stale) {
    try { if (await settleStaleOrder(order) === "canceled") released++; }
    catch (error) { console.error("Could not settle expired checkout", order.number, error instanceof Error ? error.message : error); }
  }
  return released;
}

async function ensureCheckoutSession(order: OrderRow, origin: string): Promise<CheckoutStartResult> {
  if (order.stripeCheckoutUrl) return { kind: "redirect", url: order.stripeCheckoutUrl, number: order.number };
  const lines = (await linesFor([order.id])).get(order.id) ?? [];
  let session: { id: string; url: string; couponId: string | null };
  try {
    const method = order.shippingMethod;
    session = await paymentGateway().createCheckout({
      orderId: order.id, number: order.number, email: order.email, expiresAt: order.reservationExpiresAt,
      shipping: {
        name: method ? (method.kind === "pickup" ? method.name : order.shippingCents === 0 ? `Free ${method.name.toLowerCase()}` : method.name) : "Delivery",
        priceCents: order.shippingCents, minDays: method?.minDays ?? null, maxDays: method?.maxDays ?? null,
      },
      discount: order.discountCents > 0 && order.couponCode ? { code: order.couponCode, amountCents: order.discountCents } : null,
      lines: lines.map(line => ({ name: line.productName, description: `${line.variantLabel} · SKU ${line.sku}`, unitPriceCents: line.unitPriceCents, quantity: line.quantity })),
      successUrl: `${origin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/checkout?payment=canceled`,
    });
  } catch (error) {
    console.error("Could not start the payment session", order.number, error instanceof Error ? error.message : error);
    await cancelPendingOrder(order.id, "expired", "payment_unavailable");
    throw new OrderError(502, "We couldn't reach the payment service. Nothing was charged. Please try again in a moment.");
  }
  const [updated] = await db.update(customerOrder)
    .set({ stripeCheckoutSessionId: session.id, stripeCheckoutUrl: session.url, stripeCouponId: session.couponId, updatedAt: new Date() })
    .where(and(eq(customerOrder.id, order.id), eq(customerOrder.status, "pending_payment"))).returning();
  if (!updated) {
    await paymentGateway().expireCheckout(session.id).catch(() => undefined);
    throw new OrderError(409, "This checkout expired. Please try again.");
  }
  return { kind: "redirect", url: session.url, number: order.number };
}

/**
 * Starts (or resumes) payment for one browser checkout attempt. The same key and the
 * same bag return the same order and payment page, so repeated clicks never create a
 * second order or a second hold. A changed bag replaces the earlier attempt.
 * Stripe sends the shopper back to `origin`, the site address they checked out from.
 */
export async function startCheckout(input: CheckoutInput, userId: string | null, origin: string): Promise<CheckoutStartResult> {
  if (!paymentsConfigured()) throw new OrderError(503, "Payments are not set up yet. Nothing was charged.");
  await releaseExpiredReservations().catch(error => console.error("Expired checkout sweep failed", error));
  const hash = requestHash(input, userId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const [existing] = await db.select().from(customerOrder).where(eq(customerOrder.checkoutKey, input.checkoutKey)).limit(1);
    if (existing?.status === "placed") return { kind: "paid", number: existing.number };
    if (existing?.status === "pending_payment") {
      const fresh = existing.reservationExpiresAt.getTime() - Date.now() > MIN_RESUME_MS;
      if (existing.requestHash === hash && fresh) return ensureCheckoutSession(existing, origin);
      if (await settleStaleOrder(existing) === "paid") return { kind: "paid", number: existing.number };
    }
    try {
      return await ensureCheckoutSession(await createOrder(input, userId, hash), origin);
    } catch (error) {
      // Another request with this key created the order first; resume that one.
      if (isUniqueViolation(error, "customer_order_checkout_key_unique")) continue;
      throw error;
    }
  }
  throw new OrderError(409, "This checkout is already being processed. Please wait a moment and try again.");
}

function summaryDTO(order: OrderRow, lines: LineRow[]): Omit<CheckoutStatusDTO, "email"> {
  return {
    number: order.number, status: order.status, paymentStatus: order.paymentStatus,
    lines: lines.map(line => ({ productName: line.productName, variantLabel: line.variantLabel, sku: line.sku, quantity: line.quantity, lineTotalCents: line.lineTotalCents, imageSrc: line.imageSrc })),
    subtotalCents: order.subtotalCents, discountCents: order.discountCents, couponCode: order.couponCode, shippingMethod: order.shippingMethod,
    shippingCents: order.shippingCents, taxCents: order.taxCents, totalCents: order.totalCents,
  };
}

const statusDTO = (order: OrderRow, lines: LineRow[]): CheckoutStatusDTO => ({ ...summaryDTO(order, lines), email: order.email });

/**
 * Guest order lookup. Only placed orders are found, only with the exact number and
 * checkout email, and the answer never says which of the two was wrong.
 */
export async function lookupOrder(number: string, email: string): Promise<OrderLookupDTO | null> {
  const [order] = await db.select().from(customerOrder)
    .where(and(eq(customerOrder.number, number), eq(customerOrder.email, email), eq(customerOrder.status, "placed"))).limit(1);
  if (!order) return null;
  return {
    ...summaryDTO(order, (await linesFor([order.id])).get(order.id) ?? []),
    placedAt: order.placedAt?.toISOString() ?? null,
    fulfillmentStatus: order.fulfillmentStatus,
    destination: order.shippingMethod?.kind === "pickup" ? order.shippingMethod.name : `${order.shipping.city}, ${order.shipping.state}`,
  };
}

/**
 * The confirmation page's view of a checkout. A pending order is checked with the
 * provider (never trusted from the redirect alone) and placed if the provider says paid.
 */
export async function checkoutStatus(sessionId: string): Promise<CheckoutStatusDTO | null> {
  if (!SESSION_ID.test(sessionId)) return null;
  let order = await orderBySession(sessionId);
  if (!order) return null;
  if (order.status === "pending_payment") {
    try {
      const state = await paymentGateway().retrieveCheckout(sessionId);
      if (state.status === "complete" && state.paymentStatus !== "unpaid") order = await confirmPaidCheckout(state, "status_check") ?? order;
      else if (state.status === "expired") {
        await cancelPendingOrder(order.id, "expired", "expired");
        order = await orderBySession(sessionId) ?? order;
      }
    } catch (error) {
      console.error("Could not check the payment session", order.number, error instanceof Error ? error.message : error);
    }
  }
  return statusDTO(order, (await linesFor([order.id])).get(order.id) ?? []);
}

/** Verified Stripe events. The event id is stored first so replays are recognized. */
export async function handleStripeEvent(event: Stripe.Event): Promise<"processed" | "duplicate" | "ignored"> {
  await db.insert(webhookEvent).values({ id: event.id, provider: "stripe", type: event.type }).onConflictDoNothing();
  const [stored] = await db.update(webhookEvent).set({ attempts: sql`${webhookEvent.attempts} + 1` })
    .where(eq(webhookEvent.id, event.id)).returning();
  if (stored?.processedAt) return "duplicate";
  let outcome: "processed" | "ignored" = "processed";
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        // Read the current state (and fee) from Stripe rather than trusting event order.
        const state = await paymentGateway().retrieveCheckout(event.data.object.id);
        if (!await confirmPaidCheckout(state, "webhook")) outcome = "ignored";
        break;
      }
      case "checkout.session.expired": {
        const order = await orderBySession(event.data.object.id);
        if (order) await cancelPendingOrder(order.id, "expired", "expired");
        else outcome = "ignored";
        break;
      }
      case "checkout.session.async_payment_failed": {
        const order = await orderBySession(event.data.object.id);
        if (order) await cancelPendingOrder(order.id, "failed", "payment_failed");
        else outcome = "ignored";
        break;
      }
      default:
        outcome = "ignored";
    }
    await db.update(webhookEvent).set({ processedAt: new Date(), lastError: null }).where(eq(webhookEvent.id, event.id));
    return outcome;
  } catch (error) {
    await db.update(webhookEvent).set({ lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500) })
      .where(eq(webhookEvent.id, event.id));
    throw error;
  }
}

function orderDTO(order: OrderRow, lines: LineRow[]): OrderDTO {
  return {
    id: order.id, number: order.number, status: order.status, paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus, email: order.email, shipping: order.shipping,
    lines: lines.map(line => ({
      variantId: line.variantId, productId: line.productId, productName: line.productName, variantLabel: line.variantLabel,
      sku: line.sku, imageSrc: line.imageSrc, unitPriceCents: line.unitPriceCents, quantity: line.quantity, lineTotalCents: line.lineTotalCents,
    })),
    subtotalCents: order.subtotalCents, discountCents: order.discountCents, couponCode: order.couponCode, shippingMethod: order.shippingMethod,
    shippingCents: order.shippingCents, taxCents: order.taxCents, totalCents: order.totalCents,
    createdAt: order.createdAt.toISOString(), placedAt: order.placedAt?.toISOString() ?? null,
    canceledAt: order.canceledAt?.toISOString() ?? null, reviewReason: order.reviewReason,
  };
}

async function withLines(orders: OrderRow[]): Promise<OrderDTO[]> {
  const lines = await linesFor(orders.map(order => order.id));
  return orders.map(order => orderDTO(order, lines.get(order.id) ?? []));
}

/** A signed-in customer's placed orders. Abandoned checkout attempts are not orders to them. */
export async function listCustomerOrders(userId: string): Promise<OrderDTO[]> {
  return withLines(await db.select().from(customerOrder)
    .where(and(eq(customerOrder.userId, userId), eq(customerOrder.status, "placed")))
    .orderBy(desc(customerOrder.placedAt)).limit(50));
}

export async function getCustomerOrder(userId: string, number: string): Promise<OrderDTO | null> {
  const [order] = await db.select().from(customerOrder)
    .where(and(eq(customerOrder.userId, userId), eq(customerOrder.number, number), eq(customerOrder.status, "placed"))).limit(1);
  return order ? (await withLines([order]))[0] : null;
}

// Callers must enforce orders:manage first.
export async function listAdminOrders(): Promise<OrderDTO[]> {
  return withLines(await db.select().from(customerOrder).orderBy(desc(customerOrder.createdAt)).limit(200));
}

export type AdminOrderDetail = OrderDTO & {
  stripePaymentIntentId: string | null;
  journals: { kind: string; memo: string; createdAt: string; lines: { account: string; debitCents: number; creditCents: number }[] }[];
  movements: { sku: string; delta: number; balanceAfter: number; createdAt: string }[];
};

// Callers must enforce orders:manage first.
export async function getAdminOrder(number: string): Promise<AdminOrderDetail | null> {
  const [order] = await db.select().from(customerOrder).where(eq(customerOrder.number, number)).limit(1);
  if (!order) return null;
  const [dto] = await withLines([order]);
  const journals = await db.select().from(ledgerJournal).where(eq(ledgerJournal.orderId, order.id)).orderBy(asc(ledgerJournal.createdAt));
  const journalLines = journals.length
    ? await db.select().from(ledgerLine).where(inArray(ledgerLine.journalId, journals.map(journal => journal.id)))
    : [];
  const movements = await db.select({ sku: catalogVariant.sku, delta: stockMovement.delta, balanceAfter: stockMovement.balanceAfter, createdAt: stockMovement.createdAt })
    .from(stockMovement).innerJoin(catalogVariant, eq(catalogVariant.id, stockMovement.variantId))
    .where(eq(stockMovement.orderId, order.id)).orderBy(asc(stockMovement.createdAt));
  return {
    ...dto,
    stripePaymentIntentId: order.stripePaymentIntentId,
    journals: journals.map(journal => ({
      kind: journal.kind, memo: journal.memo, createdAt: journal.createdAt.toISOString(),
      lines: journalLines.filter(line => line.journalId === journal.id).map(line => ({ account: line.account, debitCents: line.debitCents, creditCents: line.creditCents })),
    })),
    movements: movements.map(movement => ({ ...movement, createdAt: movement.createdAt.toISOString() })),
  };
}
