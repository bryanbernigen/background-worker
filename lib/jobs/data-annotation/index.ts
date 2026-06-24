import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { fetchDataAnnotationPage } from './fetch';
import { parseDataAnnotation, extractPaidItems, extractSessionExpiry } from './parse';
import { formatNotification } from './format';
import { diffNewItems } from './diff';
import { decrypt } from '@/lib/crypto';
import { WahaClient } from '@/lib/waha';
import { jobs } from '@/lib/db/schema';
import type { JobModule, RunContext, RunResult } from '../types';
import CustomSettingsPanel from './settings-panel';

export const customSettingsSchema = z.object({
  cookie_encrypted:  z.string().optional(),
  // nullable: cleared to null on a fresh cookie save, then repopulated by the validation run.
  cookie_expires_at: z.number().nullable().optional(),  // epoch ms, read from the site
  cookie_checked_at: z.number().nullable().optional(),  // epoch ms, when expiry was last read
  cookie_warned:     z.boolean().optional(), // 24h warning already sent for this cookie
  cookie_invalid:    z.boolean().optional(), // last fetch was rejected (auth)
});

/** Merge a patch into the job's custom_settings without clobbering other keys. */
async function persistCookieState(ctx: RunContext, patch: Record<string, unknown>): Promise<void> {
  const base = (ctx.custom ?? {}) as Record<string, unknown>;
  await ctx.db.update(jobs)
    .set({ customSettings: { ...base, ...patch }, updatedAt: new Date() })
    .where(eq(jobs.id, ctx.jobId));
}

export const dataAnnotation: JobModule = {
  slug: 'data-annotation',
  defaultMeta: {
    title: 'Data Annotation',
    url: 'https://app.dataannotation.tech/workers/projects',
    description: 'Monitor paid projects and qualifications on DataAnnotation.',
  },
  customSettingsSchema,
  CustomSettingsPanel,

  async runCheck(ctx: RunContext): Promise<RunResult> {
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

    // Capture the real session expiry the site embeds in the page. Only
    // overwrite the stored value when we actually found one, so a parse miss
    // doesn't wipe a previously-known expiry.
    const expiresAt = extractSessionExpiry(html);
    const cookieState: Record<string, unknown> = { cookie_checked_at: Date.now(), cookie_invalid: false };
    if (expiresAt) cookieState.cookie_expires_at = expiresAt;
    await persistCookieState(ctx, cookieState);

    const items = extractPaidItems(props);
    const newItems = diffNewItems(items, ctx.lastSuccessfulItems);

    const allProjects = items.filter(i => !i.qualification).length;
    const allQuals    = items.filter(i =>  i.qualification).length;
    const paidProjects = items.filter(i => !i.qualification && isPaidStr(i.pay)).length;
    const paidQuals    = items.filter(i =>  i.qualification && isPaidStr(i.pay)).length;

    const newAllProjects = newItems.filter(i => !i.qualification).length;
    const newAllQuals    = newItems.filter(i =>  i.qualification).length;
    const newPaidProjects = newItems.filter(i => !i.qualification && isPaidStr(i.pay)).length;
    const newPaidQuals    = newItems.filter(i =>  i.qualification && isPaidStr(i.pay)).length;

    // Notification trigger (spec §2 Goals): new_paid_projects > 0 OR new_all_qualifications > 0.
    let notificationSent = false;
    if (newPaidProjects > 0 || newAllQuals > 0) {
      const wahaUrl = process.env.WAHA_URL;
      if (wahaUrl && ctx.recipients.length) {
        const waha = new WahaClient(wahaUrl, process.env.WAHA_API_KEY ?? '');
        const msg = formatNotification(newItems);
        for (const r of ctx.recipients) {
          try { await waha.sendText(r.phone, msg); notificationSent = true; }
          catch (e) { console.error(`[da] waha send failed for ${r.phone}`, e); }
        }
      }
    }

    return {
      status: 'ok',
      paidProjects, allProjects,
      paidQualifications: paidQuals, allQualifications: allQuals,
      newPaidProjects,   newAllProjects,
      newPaidQualifications: newPaidQuals, newAllQualifications: newAllQuals,
      extractedItems: items,
      notificationSent,
    };
  },
};

function isPaidStr(pay: string): boolean { return pay?.includes('$') ?? false; }

function mkError(message: string, rawHtml?: string): RunResult {
  return {
    status: 'error',
    paidProjects: 0, allProjects: 0,
    paidQualifications: 0, allQualifications: 0,
    newPaidProjects: 0, newAllProjects: 0,
    newPaidQualifications: 0, newAllQualifications: 0,
    extractedItems: [], errorMessage: message, rawHtml, notificationSent: false,
  };
}
