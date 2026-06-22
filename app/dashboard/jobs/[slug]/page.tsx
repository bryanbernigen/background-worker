import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { verifySessionToken } from '@/lib/auth';
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

export default async function JobPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const token = (await cookies()).get('session')?.value;
  if (!token || !(await verifySessionToken(token))) redirect('/');

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return notFound();
  const mod = getJob(slug);

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
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">← Dashboard</a>

        <EditableHeader slug={slug} initial={{
          title: job.title, url: job.url, description: job.description,
        }} />

        <div className="flex items-center gap-4">
          <Countdown slug={slug} initial={{
            nextRunAt: job.nextRunAt?.toISOString() ?? null,
            lastRunAt: job.lastRunAt?.toISOString() ?? null,
            minIntervalS: job.minIntervalS,
            maxIntervalS: job.maxIntervalS,
            enabled: job.enabled,
          }} />
          <div className="shrink-0 flex items-start gap-2">
            <RunNowButton slug={slug} />
            <EnableToggle slug={slug} initialEnabled={job.enabled} />
          </div>
        </div>

        <ScheduleForm slug={slug} initial={{
          minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
          dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
        }} />
        {Panel && <Panel jobId={job.id} current={customForPanel} />}
        <RecipientsPanel slug={slug} kind="project" title="WhatsApp recipients (new-task alerts)" />
        <RecipientsPanel slug={slug} kind="cookie" title="Cookie-expiry alert recipients" />
        <HistoryTable slug={slug} />
      </div>
    </div>
  );
}
