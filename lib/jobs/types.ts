import type { ComponentType } from 'react';
import type { ZodSchema } from 'zod';
import type { db } from '@/lib/db/client';

export interface PaidItem {
  id: string;
  name: string;
  pay: string;
  availableTasksFor: string;
  created: string;
  qualification: boolean;
}

export interface RunContext {
  jobId: number;
  meta: { title: string; url: string; description: string };
  custom: unknown;
  db: typeof db;
  recipients: { id: number; name: string; phone: string }[];
  lastSuccessfulItems: PaidItem[];
}

export type RunStatus = 'ok' | 'error' | 'skipped';

export interface RunResult {
  status: RunStatus;
  paidProjects: number;            allProjects: number;
  paidQualifications: number;      allQualifications: number;
  newPaidProjects: number;         newAllProjects: number;
  newPaidQualifications: number;   newAllQualifications: number;
  extractedItems: PaidItem[];
  rawHtml?: string;
  errorMessage?: string;
  notificationSent: boolean;
}

export interface JobModule {
  slug: string;
  defaultMeta: { title: string; url: string; description: string };
  customSettingsSchema?: ZodSchema;
  CustomSettingsPanel?: ComponentType<{ jobId: number; current: unknown }>;
  runCheck(ctx: RunContext): Promise<RunResult>;
}
