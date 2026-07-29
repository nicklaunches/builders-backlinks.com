CREATE TYPE "public"."category" AS ENUM('AI', 'Analytics', 'CMS', 'Communication', 'Content Creation', 'Data', 'Design Tools', 'Developer Tools', 'DevOps', 'E-Commerce', 'Education', 'Finance', 'Food & Drink', 'Gaming', 'Health & Fitness', 'HR & Recruiting', 'Image', 'Jobs & Careers', 'Launch Platforms', 'Legal', 'Lifestyle', 'Marketing', 'Monitoring', 'Music', 'No Code', 'Open Source', 'Productivity', 'Sales', 'Search', 'Security', 'SEO', 'Social Media', 'Sustainability', 'Travel', 'Video', 'Web3', 'Writing', 'Other');--> statement-breakpoint
CREATE TYPE "public"."digest_cadence" AS ENUM('weekly', 'biweekly', 'paused');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('promised', 'live', 'missing', 'removed');--> statement-breakpoint
CREATE TYPE "public"."match_state" AS ENUM('proposed', 'a_accepted', 'b_accepted', 'agreed', 'placed', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."placement" AS ENUM('content', 'footer', 'nav', 'sidebar', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."placement_offer" AS ENUM('blog_post', 'resources_page', 'existing_article', 'unsure');--> statement-breakpoint
CREATE TYPE "public"."site_status" AS ENUM('pending_review', 'active', 'paused', 'rejected', 'banned');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "exchange_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"from_site_id" uuid NOT NULL,
	"to_site_id" uuid NOT NULL,
	"page_url" text,
	"anchor_text" text,
	"status" "link_status" DEFAULT 'promised' NOT NULL,
	"placement" "placement" DEFAULT 'unknown' NOT NULL,
	"rel" text[] DEFAULT '{}' NOT NULL,
	"sitewide" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"check_count" integer DEFAULT 0 NOT NULL,
	"removed_at" timestamp with time zone,
	"last_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_a_id" uuid NOT NULL,
	"site_b_id" uuid NOT NULL,
	"category" "category" NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"widened" boolean DEFAULT false NOT NULL,
	"state" "match_state" DEFAULT 'proposed' NOT NULL,
	"proposed_by_id" uuid,
	"decline_reason" text,
	"agreed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"api_key_hash" text,
	"api_key_issued_at" timestamp with time zone,
	"api_key_last_used_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"digest_cadence" "digest_cadence" DEFAULT 'weekly' NOT NULL,
	"last_digest_sent_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"url" text NOT NULL,
	"category" "category" NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"description" text NOT NULL,
	"domain_rating" integer,
	"true_dr" integer,
	"dr_checked_at" timestamp with time zone,
	"placement_offered" "placement_offer" DEFAULT 'unsure' NOT NULL,
	"status" "site_status" DEFAULT 'pending_review' NOT NULL,
	"review_note" text,
	"links_given" integer DEFAULT 0 NOT NULL,
	"links_got" integer DEFAULT 0 NOT NULL,
	"trust_score" integer DEFAULT 50 NOT NULL,
	"last_matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_sites_domain_rating_range" CHECK ("exchange_sites"."domain_rating" between 0 and 100),
	CONSTRAINT "exchange_sites_true_dr_range" CHECK ("exchange_sites"."true_dr" between 0 and 100),
	CONSTRAINT "exchange_sites_trust_score_range" CHECK ("exchange_sites"."trust_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" integer NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_links" ADD CONSTRAINT "exchange_links_match_id_exchange_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."exchange_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_links" ADD CONSTRAINT "exchange_links_from_site_id_exchange_sites_id_fk" FOREIGN KEY ("from_site_id") REFERENCES "public"."exchange_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_links" ADD CONSTRAINT "exchange_links_to_site_id_exchange_sites_id_fk" FOREIGN KEY ("to_site_id") REFERENCES "public"."exchange_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_matches" ADD CONSTRAINT "exchange_matches_site_a_id_exchange_sites_id_fk" FOREIGN KEY ("site_a_id") REFERENCES "public"."exchange_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_matches" ADD CONSTRAINT "exchange_matches_site_b_id_exchange_sites_id_fk" FOREIGN KEY ("site_b_id") REFERENCES "public"."exchange_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_matches" ADD CONSTRAINT "exchange_matches_proposed_by_id_users_id_fk" FOREIGN KEY ("proposed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_members" ADD CONSTRAINT "exchange_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_sites" ADD CONSTRAINT "exchange_sites_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_links_direction_idx" ON "exchange_links" USING btree ("match_id","from_site_id","to_site_id");--> statement-breakpoint
CREATE INDEX "exchange_links_from_idx" ON "exchange_links" USING btree ("from_site_id");--> statement-breakpoint
CREATE INDEX "exchange_links_to_idx" ON "exchange_links" USING btree ("to_site_id");--> statement-breakpoint
CREATE INDEX "exchange_links_recheck_idx" ON "exchange_links" USING btree ("status","last_checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_matches_pair_idx" ON "exchange_matches" USING btree ("site_a_id","site_b_id");--> statement-breakpoint
CREATE INDEX "exchange_matches_state_idx" ON "exchange_matches" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "exchange_matches_site_a_idx" ON "exchange_matches" USING btree ("site_a_id");--> statement-breakpoint
CREATE INDEX "exchange_matches_site_b_idx" ON "exchange_matches" USING btree ("site_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_members_user_idx" ON "exchange_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "exchange_members_email_idx" ON "exchange_members" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_members_api_key_idx" ON "exchange_members" USING btree ("api_key_hash");--> statement-breakpoint
CREATE INDEX "exchange_members_digest_idx" ON "exchange_members" USING btree ("unsubscribed_at","last_digest_sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_sites_domain_idx" ON "exchange_sites" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "exchange_sites_owner_idx" ON "exchange_sites" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "exchange_sites_matching_idx" ON "exchange_sites" USING btree ("category","status","domain_rating");--> statement-breakpoint
CREATE INDEX "exchange_sites_staleness_idx" ON "exchange_sites" USING btree ("status","last_matched_at");--> statement-breakpoint
CREATE INDEX "rate_limits_expiry_idx" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");