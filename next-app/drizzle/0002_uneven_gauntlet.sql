ALTER TABLE "exchange_sites" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exchange_sites" ADD COLUMN "status_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "exchange_sites" ADD CONSTRAINT "exchange_sites_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;