CREATE TYPE "public"."catalog_product_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_reason" AS ENUM('initial', 'adjustment');--> statement-breakpoint
CREATE TABLE "catalog_product" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"vendor_name" text NOT NULL,
	"store_id" text,
	"description" text NOT NULL,
	"details" jsonb NOT NULL,
	"option_names" jsonb NOT NULL,
	"swatches" jsonb NOT NULL,
	"media" jsonb NOT NULL,
	"status" "catalog_product_status" DEFAULT 'draft' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "catalog_product_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "catalog_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"sku" text NOT NULL,
	"options" jsonb NOT NULL,
	"price_cents" integer NOT NULL,
	"compare_at_cents" integer,
	"media_ids" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_variant_sku_unique" UNIQUE("sku"),
	CONSTRAINT "catalog_variant_price_positive" CHECK ("catalog_variant"."price_cents" > 0),
	CONSTRAINT "catalog_variant_compare_at_above_price" CHECK ("catalog_variant"."compare_at_cents" IS NULL OR "catalog_variant"."compare_at_cents" > "catalog_variant"."price_cents")
);
--> statement-breakpoint
CREATE TABLE "inventory_balance" (
	"variant_id" text PRIMARY KEY NOT NULL,
	"on_hand" integer NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_balance_on_hand_nonnegative" CHECK ("inventory_balance"."on_hand" >= 0),
	CONSTRAINT "inventory_balance_reserved_valid" CHECK ("inventory_balance"."reserved" >= 0 AND "inventory_balance"."reserved" <= "inventory_balance"."on_hand")
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" "stock_movement_reason" NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movement_delta_nonzero" CHECK ("stock_movement"."delta" <> 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_product" ADD CONSTRAINT "catalog_product_store_id_seller_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."seller_store"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_variant" ADD CONSTRAINT "catalog_variant_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balance" ADD CONSTRAINT "inventory_balance_variant_id_catalog_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."catalog_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_variant_id_catalog_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."catalog_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_product_status_idx" ON "catalog_product" USING btree ("status","position");--> statement-breakpoint
CREATE INDEX "catalog_variant_product_idx" ON "catalog_variant" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "stock_movement_variant_idx" ON "stock_movement" USING btree ("variant_id","created_at");