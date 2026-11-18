import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgSequence, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { ProductMedia } from "../lib/catalog";
import type { OrderShippingMethod } from "../lib/checkout";
import { roles } from "../lib/permissions";
import type { SellerApplicationFields } from "../lib/seller-application";

export const userRole = pgEnum("user_role", roles);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: userRole("role").default("customer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_idx").on(table.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("account_user_idx").on(table.userId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const auditEvent = pgTable("audit_event", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  subjectId: text("subject_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sellerApplicationStatus = pgEnum("seller_application_status", ["draft", "submitted", "changes_requested", "approved"]);

export const sellerApplication = pgTable("seller_application", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
  status: sellerApplicationStatus("status").default("draft").notNull(),
  version: integer("version").default(1).notNull(),
  fields: jsonb("fields").$type<SellerApplicationFields>().notNull(),
  feedback: text("feedback").default("").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [index("seller_application_status_idx").on(table.status)]);

export const sellerStore = pgTable("seller_store", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
  applicationId: text("application_id").notNull().unique().references(() => sellerApplication.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  fields: jsonb("fields").$type<SellerApplicationFields>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const catalogProductStatus = pgEnum("catalog_product_status", ["draft", "published", "archived"]);

export const catalogProduct = pgTable("catalog_product", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  vendorName: text("vendor_name").notNull(),
  // Reserved for seller-owned listings; house products have no store.
  storeId: text("store_id").references(() => sellerStore.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  details: jsonb("details").$type<string[]>().notNull(),
  optionNames: jsonb("option_names").$type<string[]>().notNull(),
  swatches: jsonb("swatches").$type<Record<string, string>>().notNull(),
  media: jsonb("media").$type<ProductMedia[]>().notNull(),
  status: catalogProductStatus("status").default("draft").notNull(),
  position: integer("position").default(0).notNull(),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (table) => [index("catalog_product_status_idx").on(table.status, table.position)]);

export const catalogVariant = pgTable("catalog_variant", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => catalogProduct.id, { onDelete: "cascade" }),
  // SKUs are unique across the catalog and are never reused, including by archived variants.
  sku: text("sku").notNull().unique(),
  options: jsonb("options").$type<Record<string, string>>().notNull(),
  priceCents: integer("price_cents").notNull(),
  compareAtCents: integer("compare_at_cents"),
  mediaIds: jsonb("media_ids").$type<string[]>().notNull(),
  position: integer("position").default(0).notNull(),
  archived: boolean("archived").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("catalog_variant_product_idx").on(table.productId, table.position),
  check("catalog_variant_price_positive", sql`${table.priceCents} > 0`),
  check("catalog_variant_compare_at_above_price", sql`${table.compareAtCents} IS NULL OR ${table.compareAtCents} > ${table.priceCents}`),
]);

// One default location for now; multi-location balances are planned (K06/K07).
export const inventoryBalance = pgTable("inventory_balance", {
  variantId: text("variant_id").primaryKey().references(() => catalogVariant.id, { onDelete: "cascade" }),
  onHand: integer("on_hand").notNull(),
  reserved: integer("reserved").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("inventory_balance_on_hand_nonnegative", sql`${table.onHand} >= 0`),
  check("inventory_balance_reserved_valid", sql`${table.reserved} >= 0 AND ${table.reserved} <= ${table.onHand}`),
]);

export const stockMovementReason = pgEnum("stock_movement_reason", ["initial", "adjustment", "sale"]);

export const orderStatus = pgEnum("order_status", ["pending_payment", "placed", "canceled"]);
export const orderPaymentStatus = pgEnum("order_payment_status", ["awaiting", "paid", "expired", "failed"]);
export const orderFulfillmentStatus = pgEnum("order_fulfillment_status", ["unfulfilled"]);
export const customerOrderNumber = pgSequence("customer_order_number_seq", { startWith: 2001 });

export type ShippingAddress = { name: string; address: string; city: string; state: string; zip: string; country: "US" };

// Versioned store settings edited as one document (for now: shipping zones and pickup).
export const storeSetting = pgTable("store_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  version: integer("version").default(1).notNull(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const couponKind = pgEnum("coupon_kind", ["percent", "fixed", "free_shipping"]);

// `usedCount` counts codes held by open checkouts plus those on paid orders, so a
// limited code can never be oversold by concurrent checkouts.
export const coupon = pgTable("coupon", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  kind: couponKind("kind").notNull(),
  percentOff: integer("percent_off"),
  amountOffCents: integer("amount_off_cents"),
  minSubtotalCents: integer("min_subtotal_cents").default(0).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  usageLimit: integer("usage_limit"),
  usedCount: integer("used_count").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("coupon_usage_valid", sql`${table.usedCount} >= 0 AND (${table.usageLimit} IS NULL OR ${table.usedCount} <= ${table.usageLimit})`),
  check("coupon_value_valid", sql`(${table.kind} = 'percent' AND ${table.percentOff} BETWEEN 1 AND 100 AND ${table.amountOffCents} IS NULL)
    OR (${table.kind} = 'fixed' AND ${table.amountOffCents} > 0 AND ${table.percentOff} IS NULL)
    OR (${table.kind} = 'free_shipping' AND ${table.percentOff} IS NULL AND ${table.amountOffCents} IS NULL)`),
]);

export const couponRedemptionStatus = pgEnum("coupon_redemption_status", ["held", "redeemed", "released"]);

// Order, payment and fulfillment states are separate (O02). A pending order holds
// reserved stock until `reservationExpiresAt`; only a verified payment places it.
export const customerOrder = pgTable("customer_order", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  // The browser's idempotency key for this checkout attempt. Cleared when the
  // attempt is canceled so the same browser checkout can start a fresh order.
  checkoutKey: text("checkout_key").unique(),
  requestHash: text("request_hash").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  email: text("email").notNull(),
  shipping: jsonb("shipping").$type<ShippingAddress>().notNull(),
  status: orderStatus("status").default("pending_payment").notNull(),
  paymentStatus: orderPaymentStatus("payment_status").default("awaiting").notNull(),
  fulfillmentStatus: orderFulfillmentStatus("fulfillment_status").default("unfulfilled").notNull(),
  currency: text("currency").default("usd").notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  discountCents: integer("discount_cents").default(0).notNull(),
  couponCode: text("coupon_code"),
  // Snapshot of the chosen delivery or pickup option; later settings edits don't change it.
  shippingMethod: jsonb("shipping_method").$type<OrderShippingMethod>(),
  shippingCents: integer("shipping_cents").notNull(),
  taxCents: integer("tax_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  stripeCouponId: text("stripe_coupon_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  stripeCheckoutUrl: text("stripe_checkout_url"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  // Set when a payment needs a person to look at it (for example, an amount mismatch).
  reviewReason: text("review_reason"),
  reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  placedAt: timestamp("placed_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
}, (table) => [
  index("customer_order_user_idx").on(table.userId, table.createdAt),
  index("customer_order_pending_idx").on(table.status, table.reservationExpiresAt),
  index("customer_order_created_idx").on(table.createdAt),
  check("customer_order_amounts_valid", sql`${table.subtotalCents} > 0 AND ${table.discountCents} >= 0 AND ${table.discountCents} <= ${table.subtotalCents} AND ${table.shippingCents} >= 0 AND ${table.taxCents} >= 0 AND ${table.totalCents} = ${table.subtotalCents} - ${table.discountCents} + ${table.shippingCents} + ${table.taxCents}`),
]);

export const couponRedemption = pgTable("coupon_redemption", {
  id: text("id").primaryKey(),
  couponId: text("coupon_id").notNull().references(() => coupon.id, { onDelete: "restrict" }),
  orderId: text("order_id").notNull().unique().references(() => customerOrder.id, { onDelete: "cascade" }),
  status: couponRedemptionStatus("status").default("held").notNull(),
  discountCents: integer("discount_cents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("coupon_redemption_coupon_idx").on(table.couponId, table.status)]);

// Lines snapshot the name, SKU and price at purchase; catalog edits never change them.
export const customerOrderLine = pgTable("customer_order_line", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => customerOrder.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  productId: text("product_id").references(() => catalogProduct.id, { onDelete: "set null" }),
  variantId: text("variant_id").notNull().references(() => catalogVariant.id, { onDelete: "restrict" }),
  sku: text("sku").notNull(),
  productName: text("product_name").notNull(),
  variantLabel: text("variant_label").notNull(),
  imageSrc: text("image_src"),
  unitPriceCents: integer("unit_price_cents").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotalCents: integer("line_total_cents").notNull(),
}, (table) => [
  uniqueIndex("customer_order_line_variant_unique").on(table.orderId, table.variantId),
  check("customer_order_line_amounts_valid", sql`${table.quantity} > 0 AND ${table.unitPriceCents} > 0 AND ${table.lineTotalCents} = ${table.unitPriceCents} * ${table.quantity}`),
]);

// Every change to an on-hand balance writes one movement in the same transaction.
export const stockMovement = pgTable("stock_movement", {
  id: text("id").primaryKey(),
  variantId: text("variant_id").notNull().references(() => catalogVariant.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: stockMovementReason("reason").notNull(),
  actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
  orderId: text("order_id").references(() => customerOrder.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("stock_movement_variant_idx").on(table.variantId, table.createdAt),
  check("stock_movement_delta_nonzero", sql`${table.delta} <> 0`),
]);

// Webhook inbox: the provider's event id is stored before processing, so a replayed
// or duplicated delivery is recognized and never applied twice.
export const webhookEvent = pgTable("webhook_event", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  type: text("type").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("last_error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const ledgerAccounts = ["stripe_receivable", "sales_revenue", "sales_discounts", "shipping_revenue", "sales_tax_payable", "payment_processing_fees"] as const;
export const ledgerAccount = pgEnum("ledger_account", ledgerAccounts);

// Double-entry journal. Each journal's debits equal its credits; corrections are new
// reversing journals, never edits. `(kind, sourceRef)` makes provider-driven posting idempotent.
export const ledgerJournal = pgTable("ledger_journal", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  sourceRef: text("source_ref").notNull(),
  orderId: text("order_id").references(() => customerOrder.id, { onDelete: "restrict" }),
  currency: text("currency").default("usd").notNull(),
  memo: text("memo").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("ledger_journal_source_unique").on(table.kind, table.sourceRef)]);

export const ledgerLine = pgTable("ledger_line", {
  id: text("id").primaryKey(),
  journalId: text("journal_id").notNull().references(() => ledgerJournal.id, { onDelete: "cascade" }),
  account: ledgerAccount("account").notNull(),
  debitCents: integer("debit_cents").default(0).notNull(),
  creditCents: integer("credit_cents").default(0).notNull(),
}, (table) => [
  index("ledger_line_journal_idx").on(table.journalId),
  check("ledger_line_one_side", sql`(${table.debitCents} > 0 AND ${table.creditCents} = 0) OR (${table.creditCents} > 0 AND ${table.debitCents} = 0)`),
]);

// Transactional outbox: written in the same transaction as the business change.
// Delivery (for example the confirmation email) is a later integration.
export const outboxEvent = pgTable("outbox_event", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  attempts: integer("attempts").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("outbox_event_topic_aggregate_unique").on(table.topic, table.aggregateId),
  index("outbox_event_pending_idx").on(table.processedAt, table.createdAt),
]);
