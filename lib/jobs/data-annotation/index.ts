import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { fetchDataAnnotationPage } from './fetch';
import { parseDataAnnotation, extractPaidItems, extractSessionExpiry } from './parse';
import { formatNotification } from './format';
import { diffNewItems } from '@/lib/jobs/shared/diff';
import { decrypt } from '@/lib/crypto';
import { jobs } from '@/lib/db/schema';
import type { JobModule, RunContext, RunResult } from '../types';
import type { PaidItem } from './types';
import CustomSettingsPanel from './settings-panel';

export const customSettingsSchema = z.object({
  cookie_encrypted:  z.string().optional(),
  cookie_expires_at: z.number().nullable().optional(),
  cookie_checked_at: z.number().nullable().optional(),
  cookie_warned:     z.boolean().optional(),
  cookie_invalid:    z.boolean().optional(),
});

async function persistCookieState(ctx: RunContext, patch: Record<string, unknown>): Promise<void> {
  const base = (ctx.custom ?? {}) as Record<string, unknown>;
  await ctx.db.update(jobs)
    .set({ customSettings: { ...base, ...patch }, updatedAt: new Date() })
    .where(eq(jobs.id, ctx.jobId));
}

interface DaData {
  paidProjects: number;          allProjects: number;
  paidQualifications: number;    allQualifications: number;
  newPaidProjects: number;       newAllProjects: number;
  newPaidQualifications: number; newAllQualifications: number;
  items: PaidItem[];
}

export const dataAnnotation: JobModule = {
  type: 'data-annotation',
  defaultMeta: {
    title: 'Data Annotation',
    url: 'https://app.dataannotation.tech/workers/projects',
    description: 'Monitor paid projects and qualifications on DataAnnotation.',
  },
  customSettingsSchema,
  CustomSettingsPanel,

  async run(ctx: RunContext): Promise<RunResult> {
    const custom = customSettingsSchema.parse(ctx.custom ?? {});
    if (!custom.cookie_encrypted) {
      return mkError('No cookie configured — open settings and paste your session cookie.');
    }
    let cookie: string;
    try { cookie = decrypt(custom.cookie_encrypted); }
    catch { return mkError('cookie unreadable — re-enter via UI'); }

    let html: string;
    try { html = await fetchDataAnnotationPage(cookie); }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('401') || msg.includes('403')) {
        await persistCookieState(ctx, { cookie_invalid: true });
        return mkError('Auth expired — please update cookie');
      }
      return mkError(`Fetch failed: ${msg}`);
    }

    const props = parseDataAnnotation(html);
    if (!props) return mkError(`Failed to parse response (HTML length: ${html.length})`, html);

    const expiresAt = extractSessionExpiry(html);
    const cookieState: Record<string, unknown> = { cookie_checked_at: Date.now(), cookie_invalid: false };
    if (expiresAt) cookieState.cookie_expires_at = expiresAt;
    await persistCookieState(ctx, cookieState);

    const items = extractPaidItems(props);
    const prevItems = ((ctx.lastSuccessful as DaData | null)?.items) ?? [];
    const newItems = diffNewItems(items, prevItems, i => i.id);

    const data: DaData = {
      allProjects:           items.filter(i => !i.qualification).length,
      allQualifications:     items.filter(i =>  i.qualification).length,
      paidProjects:          items.filter(i => !i.qualification && isPaidStr(i.pay)).length,
      paidQualifications:    items.filter(i =>  i.qualification && isPaidStr(i.pay)).length,
      newAllProjects:        newItems.filter(i => !i.qualification).length,
      newAllQualifications:  newItems.filter(i =>  i.qualification).length,
      newPaidProjects:       newItems.filter(i => !i.qualification && isPaidStr(i.pay)).length,
      newPaidQualifications: newItems.filter(i =>  i.qualification && isPaidStr(i.pay)).length,
      items,
    };

    let notificationSent = false;
    if (newItems.length > 0) {
      notificationSent = await ctx.notify(formatNotification(newItems), { tag: 'new-task' });
    }

    return { status: 'ok', summary: formatDaSummary(data), data, notificationSent };
  },
};

/** Run summary: `paid/total (+newPaid/+newAll)` per bucket, projects then qualifications. */
export function formatDaSummary(d: DaData): string {
  return (
    `projects: ${d.paidProjects}/${d.allProjects} (+${d.newPaidProjects}/+${d.newAllProjects})\n` +
    `qualifications: ${d.paidQualifications}/${d.allQualifications} (+${d.newPaidQualifications}/+${d.newAllQualifications})`
  );
}

function isPaidStr(pay: string): boolean { return pay?.includes('$') ?? false; }

function mkError(message: string, rawHtml?: string): RunResult {
  return { status: 'error', summary: message, errorMessage: message, rawHtml, notificationSent: false };
}
