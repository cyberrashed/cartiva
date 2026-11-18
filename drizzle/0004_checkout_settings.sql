CREATE TYPE "public"."coupon_kind" AS ENUM('percent', 'fixed', 'free_shipping');--> statement-breakpoint
CREATE TYPE "public"."coupon_redemption_status" AS ENUM('held', 'redeemed', 'released');--> statement-breakpoint
ALTER TYPE "public"."ledger_account" ADD VALUE 'sales_discounts' BEFORE 'shipping_revenue';--> statement-breakpoint
CREATE TABLE "coupon" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"kind" "coupon_kind" NOT NULL,
	"percent_off" integer,
	"amount_off_cents" integer,
	"min_subtotal_cents" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_code_unique" UNIQUE("code"),
	CONSTRAINT "coupon_usage_valid" CHECK ("coupon"."used_count" >= 0 AND ("coupon"."usage_limit" IS NULL OR "coupon"."used_count" <= "coupon"."usage_limit")),
	CONSTRAINT "coupon_value_valid" CHECK (("coupon"."kind" = 'percent' AND "coupon"."percent_off" BETWEEN 1 AND 100 AND "coupon"."amount_off_cents" IS NULL)
    OR ("coupon"."kind" = 'fixed' AND "coupon"."amount_off_cents" > 0 AND "coupon"."percent_off" IS NULL)
    OR ("coupon"."kind" = 'free_shipping' AND "coupon"."percent_off" IS NULL AND "coupon"."amount_off_cents" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "coupon_redemption" (
	"id" text PRIMARY KEY NOT NULL,
	"coupon_id" text NOT NULL,
	"order_id" text NOT NULL,
	"status" "coupon_redemption_status" DEFAULT 'held' NOT NULL,
	"discount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemption_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "store_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_order" DROP CONSTRAINT "customer_order_amounts_valid";--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "coupon_code" text;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "shipping_method" jsonb;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "stripe_coupon_id" text;--> statement-breakpoint
ALTER TABLE "coupon_redemption" ADD CONSTRAINT "coupon_redemption_coupon_id_coupon_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupon"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemption" ADD CONSTRAINT "coupon_redemption_order_id_customer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_setting" ADD CONSTRAINT "store_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupon_redemption_coupon_idx" ON "coupon_redemption" USING btree ("coupon_id","status");--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_amounts_valid" CHECK ("customer_order"."subtotal_cents" > 0 AND "customer_order"."discount_cents" >= 0 AND "customer_order"."discount_cents" <= "customer_order"."subtotal_cents" AND "customer_order"."shipping_cents" >= 0 AND "customer_order"."tax_cents" >= 0 AND "customer_order"."total_cents" = "customer_order"."subtotal_cents" - "customer_order"."discount_cents" + "customer_order"."shipping_cents" + "customer_order"."tax_cents");