ALTER TABLE "jobs" ADD COLUMN "schedule_type" text DEFAULT 'window' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "interval_s" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "cron_expr" text;