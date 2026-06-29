ALTER TABLE "jobs" ADD COLUMN "type" text;--> statement-breakpoint
UPDATE "jobs" SET "type" = "slug" WHERE "type" IS NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "recipients" RENAME COLUMN "kind" TO "tag";--> statement-breakpoint
ALTER TABLE "recipients" ALTER COLUMN "tag" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "recipients" ALTER COLUMN "tag" DROP NOT NULL;--> statement-breakpoint
UPDATE "recipients" SET "tag" = 'new-task' WHERE "tag" = 'project';--> statement-breakpoint
UPDATE "recipients" SET "tag" = 'cookie-expiry' WHERE "tag" = 'cookie';--> statement-breakpoint

ALTER TABLE "run_history" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "run_history" ADD COLUMN "data" jsonb;--> statement-breakpoint
UPDATE "run_history" SET "data" = jsonb_build_object(
  'paidProjects', "paid_projects", 'allProjects', "all_projects",
  'paidQualifications', "paid_qualifications", 'allQualifications', "all_qualifications",
  'newPaidProjects', "new_paid_projects", 'newAllProjects', "new_all_projects",
  'newPaidQualifications', "new_paid_qualifications", 'newAllQualifications', "new_all_qualifications",
  'items', "extracted_items"
);--> statement-breakpoint
UPDATE "run_history" SET "summary" =
  CASE WHEN ("new_paid_projects" + "new_all_projects" + "new_paid_qualifications" + "new_all_qualifications") > 0
       THEN ('+' || ("new_paid_projects" + "new_all_projects")::text || ' projects, +'
              || ("new_paid_qualifications" + "new_all_qualifications")::text || ' quals')
       ELSE 'no change' END
  WHERE "status" = 'ok';--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "paid_projects";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "all_projects";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "paid_qualifications";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "all_qualifications";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "new_paid_projects";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "new_all_projects";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "new_paid_qualifications";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "new_all_qualifications";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "extracted_items";