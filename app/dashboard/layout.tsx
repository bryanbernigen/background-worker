import { redirect } from 'next/navigation';
import { desc, eq, and, isNull, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs, runHistory } from '@/lib/db/schema';
import { resolveRole } from '@/lib/access/role';
import { getAdminContactPhone } from '@/lib/access/settings';
import { getWahaConfig } from '@/lib/waha-config';
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

  const active = isAdmin
    ? await db.select().from(jobs).where(isNull(jobs.archivedAt))
    : await db.select().from(jobs).where(and(eq(jobs.visibleToGuest, true), isNull(jobs.archivedAt)));
  const archived = isAdmin
    ? await db.select().from(jobs).where(isNotNull(jobs.archivedAt))
    : [];

  const toRail = async (j: typeof active[number]) => ({
    slug: j.slug, title: j.title, type: j.type, scheduleType: j.scheduleType,
    visibleToGuest: j.visibleToGuest, status: await latestStatus(j.id),
  });
  const activeJobs = await Promise.all(active.map(toRail));
  const archivedJobs = await Promise.all(archived.map(toRail));
  const contactEnabled = !isAdmin && !!(await getAdminContactPhone()) && !!(await getWahaConfig()).url;

  return (
    <div className="h-screen overflow-hidden flex bg-bg text-text">
      <Rail active={activeJobs} archived={archivedJobs} isAdmin={isAdmin} contactEnabled={contactEnabled} />
      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  );
}
