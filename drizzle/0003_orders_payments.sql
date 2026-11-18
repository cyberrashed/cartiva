CREATE TYPE "public"."ledger_account" AS ENUM('stripe_receivable', 'sales_revenue', 'shipping_revenue', 'sales_tax_payable', 'payment_processing_fees');--> statement-breakpoint
CREATE TYPE "public"."order_fulfillment_status" AS ENUM('unfulfilled');--> statement-breakpoint
CREATE TYPE "public"."order_payment_status" AS ENUM('awaiting', 'paid', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'placed', 'canceled');--> statement-breakpoint
ALTER TYPE "public"."stock_movement_reason" ADD VALUE 'sale';--> statement-breakpoint
CREATE SEQUENCE "public"."customer_order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 2001 CACHE 1;--> statement-breakpoint
CREATE TABLE "customer_order" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"checkout_key" text,
	"request_hash" text NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"shipping" jsonb NOT NULL,
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"payment_status" "order_payment_status" DEFAULT 'awaiting' NOT NULL,
	"fulfillment_status" "order_fulfillment_status" DEFAULT 'unfulfilled' NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"shipping_cents" integer NOT NULL,
	"tax_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_checkout_url" text,
	"stripe_payment_intent_id" text,
	"review_reason" text,
	"reservation_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"placed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "customer_order_number_unique" UNIQUE("number"),
	CONSTRAINT "customer_order_checkout_key_unique" UNIQUE("checkout_key"),
	CONSTRAINT "customer_order_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "customer_order_amounts_valid" CHECK ("customer_order"."subtotal_cents" > 0 AND "customer_order"."shipping_cents" >= 0 AND "customer_order"."tax_cents" >= 0 AND "customer_order"."total_cents" = "customer_order"."subtotal_cents" + "customer_order"."shipping_cents" + "customer_order"."tax_cents")
);
--> statement-breakpoint
CREATE TABLE "customer_order_line" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"position" integer NOT NULL,
	"product_id" text,
	"variant_id" text NOT NULL,
	"sku" text NOT NULL,
	"product_name" text NOT NULL,
	"variant_label" text NOT NULL,
	"image_src" text,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	CONSTRAINT "customer_order_line_amounts_valid" CHECK ("customer_order_line"."quantity" > 0 AND "customer_order_line"."unit_price_cents" > 0 AND "customer_order_line"."line_total_cents" = "customer_order_line"."unit_price_cents" * "customer_order_line"."quantity")
);
--> statement-breakpoint
CREATE TABLE "ledger_journal" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"order_id" text,
	"currency" text DEFAULT 'usd' NOT NULL,
	"memo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_line" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_id" text NOT NULL,
	"account" "ledger_account" NOT NULL,
	"debit_cents" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ledger_line_one_side" CHECK (("ledger_line"."debit_cents" > 0 AND "ledger_line"."credit_cents" = 0) OR ("ledger_line"."credit_cents" > 0 AND "ledger_line"."debit_cents" = 0))
);
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_order_line" ADD CONSTRAINT "customer_order_line_order_id_customer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_order_line" ADD CONSTRAINT "customer_order_line_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_order_line" ADD CONSTRAINT "customer_order_line_variant_id_catalog_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."catalog_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journal" ADD CONSTRAINT "ledger_journal_order_id_customer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_line" ADD CONSTRAINT "ledger_line_journal_id_ledger_journal_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."ledger_journal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_order_user_idx" ON "customer_order" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_order_pending_idx" ON "customer_order" USING btree ("status","reservation_expires_at");--> statement-breakpoint
CREATE INDEX "customer_order_created_idx" ON "customer_order" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_order_line_variant_unique" ON "customer_order_line" USING btree ("order_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_journal_source_unique" ON "ledger_journal" USING btree ("kind","source_ref");--> statement-breakpoint
CREATE INDEX "ledger_line_journal_idx" ON "ledger_line" USING btree ("journal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_event_topic_aggregate_unique" ON "outbox_event" USING btree ("topic","aggregate_id");--> statement-breakpoint
CREATE INDEX "outbox_event_pending_idx" ON "outbox_event" USING btree ("processed_at","created_at");--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_order_id_customer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE set null ON UPDATE no action;