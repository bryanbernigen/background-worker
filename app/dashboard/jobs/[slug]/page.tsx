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
      <div className="max-w-4xl mx-auto space-y-6">
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
          }} />
          <div className="shrink-0">
            <RunNowButton slug={slug} />
          </div>
        </div>

        <ScheduleForm slug={slug} initial={{
          minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
          dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
          enabled: job.enabled,
        }} />
        {Panel && <Panel jobId={job.id} current={customForPanel} />}
        <RecipientsPanel slug={slug} />
        <HistoryTable slug={slug} />
      </div>
    </div>
  );
}
