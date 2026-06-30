import type { ComponentType } from 'react';
import type { ZodSchema } from 'zod';
import type { db } from '@/lib/db/client';

export type RunStatus = 'ok' | 'error' | 'skipped';

export interface RunResult {
  status: RunStatus;
  /** Short human-readable line for the dashboard, e.g. "4 new paid projects". */
  summary: string;
  /** Free-form payload the job type defines for itself (persisted as JSONB). */
  data?: unknown;
  errorMessage?: string;
  /** Optional debug blob captured on error (e.g. raw HTML). */
  rawHtml?: string;
  notificationSent: boolean;
}

export interface Recipient {
  id: number;
  name: string;
  phone: string;
  /** Free-form grouping the job type defines, e.g. 'new-task' | 'cookie-expiry'. */
  tag: string | null;
}

/** Fan-out sender injected into a run. Filters recipients by `tag` when given. */
export type Notify = (message: string, opts?: { tag?: string }) => Promise<boolean>;

export interface RunContext {
  jobId: number;
  meta: { title: string; url: string; description: string };
  custom: unknown;
  db: typeof db;
  recipients: Recipient[];
  /** `data` from the previous successful run of this instance (job-defined shape). */
  lastSuccessful: unknown;
  notify: Notify;
}

export interface JobModule {
  /** Stable id of the job TYPE (which module powers an instance), e.g. 'data-annotation'. */
  type: string;
  defaultMeta: { title: string; url: string; description: string };
  customSettingsSchema?: ZodSchema;
  CustomSettingsPanel?: ComponentType<{ jobId: number; current: unknown }>;
  run(ctx: RunContext): Promise<RunResult>;
}
