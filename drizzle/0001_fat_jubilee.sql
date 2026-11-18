CREATE TYPE "public"."seller_application_status" AS ENUM('draft', 'submitted', 'changes_requested', 'approved');--> statement-breakpoint
CREATE TABLE "seller_application" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" "seller_application_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"fields" jsonb NOT NULL,
	"feedback" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "seller_application_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "seller_store" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"application_id" text NOT NULL,
	"name" text NOT NULL,
	"fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_store_owner_id_unique" UNIQUE("owner_id"),
	CONSTRAINT "seller_store_application_id_unique" UNIQUE("application_id")
);
--> statement-breakpoint
ALTER TABLE "seller_application" ADD CONSTRAINT "seller_application_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_store" ADD CONSTRAINT "seller_store_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_store" ADD CONSTRAINT "seller_store_application_id_seller_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."seller_application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seller_application_status_idx" ON "seller_application" USING btree ("status");