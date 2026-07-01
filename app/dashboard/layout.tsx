import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs, runHistory } from '@/lib/db/schema';
import { resolveRole } from '@/lib/access/role';
import { getAdminContactPhone } from '@/lib/access/settings';
import Rail from './rail';

async function latestStatus(jobId: number): Promise<string> {
  const [row] = await db.select({ status: runHistory.status, startedAt: runHistory.startedAt })
    .from(runHistory).where(eq(runHistory.jobId, jobId))
    .orderBy(desc(runHistory.startedAt)).limit(1);
  return row?.status ?? 'idle';
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const role = await resolveRole();
  if (!role) redirect('/');
  const isAdmin = role === 'admin';

  const rows = isAdmin
    ? await db.select().from(jobs)
    : await db.select().from(jobs).where(eq(jobs.visibleToGuest, true));
  const railJobs = await Promise.all(rows.map(async j => ({
    slug: j.slug, title: j.title, type: j.type, scheduleType: j.scheduleType,
    visibleToGuest: j.visibleToGuest, status: await latestStatus(j.id),
  })));
  const contactEnabled = !isAdmin && !!(await getAdminContactPhone()) && !!process.env.WAHA_URL;

  return (
    <div className="min-h-screen flex bg-bg text-text">
      <Rail jobs={railJobs} isAdmin={isAdmin} contactEnabled={contactEnabled} />
      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  );
}
