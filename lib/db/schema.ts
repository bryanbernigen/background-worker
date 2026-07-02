import {
  pgTable, serial, bigserial, text, integer, boolean, jsonb,
  timestamp, index,
} from 'drizzle-orm/pg-core';

export const jobs = pgTable('jobs', {
  id:             serial('id').primaryKey(),
  slug:           text('slug').notNull().unique(),
  type:           text('type').notNull(),
  title:          text('title').notNull(),
  url:            text('url').notNull(),
  description:    text('description').notNull(),
  minIntervalS:   integer('min_interval_s').notNull().default(600),
  maxIntervalS:   integer('max_interval_s').notNull().default(1800),
  dayStartHour:   integer('day_start_hour').notNull().default(7),
  dayEndHour:     integer('day_end_hour').notNull().default(23),
  tzOffsetH:      integer('tz_offset_h').notNull().default(7),
  enabled:        boolean('enabled').notNull().default(true),
  scheduleType:   text('schedule_type').notNull().default('window'),
  intervalS:      integer('interval_s'),
  cronExpr:       text('cron_expr'),
  visibleToGuest: boolean('visible_to_guest').notNull().default(true),
  customSettings: jsonb('custom_settings').notNull().default({}),
  nextRunAt:      timestamp('next_run_at', { withTimezone: true }),
  lastRunAt:      timestamp('last_run_at', { withTimezone: true }),
  archivedAt:     timestamp('archived_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipients = pgTable(
  'recipients',
  {
    id:        serial('id').primaryKey(),
    jobId:     integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    name:      text('name').notNull(),
    phone:     text('phone').notNull(),
    // free-form grouping the job type defines (e.g. 'new-task', 'cookie-expiry')
    tag:       text('tag'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({ jobIdx: index('recipients_job_id_idx').on(t.jobId) }),
);

export const runHistory = pgTable(
  'run_history',
  {
    id:                     bigserial('id', { mode: 'number' }).primaryKey(),
    jobId:                  integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    startedAt:              timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt:             timestamp('finished_at', { withTimezone: true }).notNull(),
    status:                 text('status').notNull(),
    triggerType:            text('trigger_type').notNull(),
    skipReason:             text('skip_reason'),
    diffMs:                 integer('diff_ms'),
    summary:                text('summary').notNull().default(''),
    data:                   jsonb('data'),
    rawHtml:                text('raw_html'),
    errorMessage:           text('error_message'),
    notificationSent:       boolean('notification_sent').notNull().default(false),
  },
  t => ({ jobStartedIdx: index('run_history_job_started_idx').on(t.jobId, t.startedAt) }),
);

export const appSettings = pgTable('app_settings', {
  key:       text('key').primaryKey(),
  value:     jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Recipient = typeof recipients.$inferSelect;
export type RunHistory = typeof runHistory.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
