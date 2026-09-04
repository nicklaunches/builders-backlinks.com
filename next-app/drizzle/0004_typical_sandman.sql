CREATE TABLE "exchange_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"sender_site_id" uuid NOT NULL,
	"body" text NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_messages_body_length" CHECK (char_length("exchange_messages"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "exchange_thread_reads" (
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_thread_reads_match_id_user_id_pk" PRIMARY KEY("match_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "exchange_matches" ADD COLUMN "a_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exchange_matches" ADD COLUMN "b_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exchange_messages" ADD CONSTRAINT "exchange_messages_match_id_exchange_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."exchange_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_messages" ADD CONSTRAINT "exchange_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_messages" ADD CONSTRAINT "exchange_messages_sender_site_id_exchange_sites_id_fk" FOREIGN KEY ("sender_site_id") REFERENCES "public"."exchange_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_thread_reads" ADD CONSTRAINT "exchange_thread_reads_match_id_exchange_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."exchange_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_thread_reads" ADD CONSTRAINT "exchange_thread_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exchange_messages_thread_idx" ON "exchange_messages" USING btree ("match_id","created_at");--> statement-breakpoint
CREATE INDEX "exchange_messages_notified_idx" ON "exchange_messages" USING btree ("match_id","notified_at");