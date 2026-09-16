ALTER TABLE "exchange_matches" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exchange_matches" ADD COLUMN "withdrawn_by_id" uuid;--> statement-breakpoint
ALTER TABLE "exchange_sites" ADD COLUMN "min_partner_dr" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "exchange_sites" ADD COLUMN "skip_unrated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exchange_matches" ADD CONSTRAINT "exchange_matches_withdrawn_by_id_users_id_fk" FOREIGN KEY ("withdrawn_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_sites" ADD CONSTRAINT "exchange_sites_min_partner_dr_range" CHECK ("exchange_sites"."min_partner_dr" between 0 and 100);