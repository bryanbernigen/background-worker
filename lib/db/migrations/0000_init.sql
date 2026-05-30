CREATE TABLE IF NOT EXISTS "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"description" text NOT NULL,
	"min_interval_s" integer DEFAULT 600 NOT NULL,
	"max_interval_s" integer DEFAULT 1800 NOT NULL,
	"day_start_hour" integer DEFAULT 7 NOT NULL,
	"day_end_hour" integer DEFAULT 23 NOT NULL,
	"tz_offset_h" integer DEFAULT 7 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"custom_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"trigger_type" text NOT NULL,
	"skip_reason" text,
	"diff_ms" integer,
	"paid_projects" integer DEFAULT 0 NOT NULL,
	"all_projects" integer DEFAULT 0 NOT NULL,
	"paid_qualifications" integer DEFAULT 0 NOT NULL,
	"all_qualifications" integer DEFAULT 0 NOT NULL,
	"new_paid_projects" integer DEFAULT 0 NOT NULL,
	"new_all_projects" integer DEFAULT 0 NOT NULL,
	"new_paid_qualifications" integer DEFAULT 0 NOT NULL,
	"new_all_qualifications" integer DEFAULT 0 NOT NULL,
	"extracted_items" jsonb,
	"raw_html" text,
	"error_message" text,
	"notification_sent" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recipients" ADD CONSTRAINT "recipients_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_history" ADD CONSTRAINT "run_history_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipients_job_id_idx" ON "recipients" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_history_job_started_idx" ON "run_history" USING btree ("job_id","started_at");