import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { resolveRole } from '@/lib/access/role';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { getJob } from '@/lib/jobs/registry';
import { decrypt } from '@/lib/crypto';
import EditableHeader from './editable-header';
import ScheduleForm from './schedule-form';
import EnableToggle from './enable-toggle';
import RecipientsPanel from './recipients-panel';
import HistoryTable from './history-table';
import Countdown from './countdown';
import RunNowButton from './run-now-button';
import LifecycleControls from './lifecycle-controls';

export default async function JobPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const role = await resolveRole();
  if (!role) redirect('/');
  const isAdmin = role === 'admin';

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return notFound();
  if (!isAdmin && (!job.visibleToGuest || job.archivedAt)) return notFound();
  const archived = !!job.archivedAt;
  const mod = getJob(job.type);

  const custom = (job.customSettings ?? {}) as Record<string, unknown>;
  const customForPanel: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(custom)) {
    if (k.endsWith('_encrypted') && typeof v === 'string') {
      try {
        const plain = decrypt(v);
        const previewKey = k.replace(/_encrypted$/, '_preview');
        customForPanel[previewKey] = plain.length <= 8
          ? '*'.repeat(plain.length)
          : `${plain.slice(0, 4)}…${plain.slice(-4)} (${plain.length} chars)`;
      } catch { /* secret unreadable — leave out */ }
    } else {
      customForPanel[k] = v;
    }
  }

  const Panel = mod?.CustomSettingsPanel;

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <a href="/dashboard" className="text-sm text-muted hover:text-text">← Console</a>

      {isAdmin ? (
        <EditableHeader slug={slug} initial={{
          title: job.title, url: job.url, description: job.description,
        }} />
      ) : (
        <div>
          <h1 className="text-2xl font-bold">{job.title}</h1>
          <p className="text-sm text-muted">{job.description}</p>
        </div>
      )}

      {isAdmin && (
        <div className="flex items-center gap-3">
          {archived && <span className="text-[11px] font-mono uppercase tracking-wider text-warn">archived</span>}
          <LifecycleControls slug={slug} archived={archived} />
        </div>
      )}

        <div className="flex items-center gap-4">
          <Countdown slug={slug} initial={{
            nextRunAt: job.nextRunAt?.toISOString() ?? null,
            lastRunAt: job.lastRunAt?.toISOString() ?? null,
            minIntervalS: job.minIntervalS,
            maxIntervalS: job.maxIntervalS,
            enabled: job.enabled,
          }} />
          {isAdmin && !archived && (
            <div className="shrink-0 flex items-start gap-2">
              <RunNowButton slug={slug} />
              <EnableToggle slug={slug} initialEnabled={job.enabled} />
            </div>
          )}
        </div>

      {isAdmin && !archived && (
        <ScheduleForm slug={slug} initial={{
          scheduleType: job.scheduleType, minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
          dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
          intervalS: job.intervalS, cronExpr: job.cronExpr,
        }} />
      )}
      {isAdmin && !archived && Panel && <Panel jobId={job.id} slug={slug} current={customForPanel} />}
      <RecipientsPanel slug={slug} tag="new-task" title="WhatsApp recipients (new-task alerts)" admin={isAdmin && !archived} />
      <RecipientsPanel slug={slug} tag="cookie-expiry" title="Cookie-expiry alert recipients" admin={isAdmin && !archived} />
      <HistoryTable slug={slug} />
    </div>
  );
}
