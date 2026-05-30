import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { verifySessionToken } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { jobs, runHistory } from '@/lib/db/schema';
import { jobRegistry } from '@/lib/jobs/registry';
import Card from '@/components/ui/card';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';

async function latestStatus(jobId: number): Promise<{ status: string; when: Date | null }> {
  const [row] = await db.select({ status: runHistory.status, startedAt: runHistory.startedAt })
    .from(runHistory).where(eq(runHistory.jobId, jobId))
    .orderBy(desc(runHistory.startedAt)).limit(1);
  return { status: row?.status ?? 'idle', when: row?.startedAt ?? null };
}

export default async function DashboardPage() {
  const token = (await cookies()).get('session')?.value;
  if (!token || !(await verifySessionToken(token))) redirect('/');

  const rows = await db.select().from(jobs);
  const data = await Promise.all(rows.map(async j => ({
    job: j,
    inRegistry: jobRegistry.some(m => m.slug === j.slug),
    ...(await latestStatus(j.id)),
  })));

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Auto Checker</h1>
          <form action="/api/auth/logout" method="POST">
            <button className="text-sm text-gray-500 hover:text-gray-700">Logout</button>
          </form>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {data.map(({ job, inRegistry, status, when }) => (
            <Card key={job.id}>
              <div className="flex items-start justify-between mb-2">
                <h2 className="text-lg font-semibold">{job.title}</h2>
                <Badge color={badgeColor(status, inRegistry)}>{inRegistry ? status : 'orphan'}</Badge>
              </div>
              <p className="text-sm text-gray-500 mb-2">{job.description}</p>
              {when && <p className="text-xs text-gray-400 mb-4">Last run: {when.toLocaleString()}</p>}
              <Link href={`/dashboard/jobs/${job.slug}`}>
                <Button className="bg-blue-600 text-white hover:bg-blue-700">Open</Button>
              </Link>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function badgeColor(status: string, inRegistry: boolean): 'green' | 'red' | 'orange' | 'gray' {
  if (!inRegistry) return 'orange';
  if (status === 'ok') return 'green';
  if (status === 'error') return 'red';
  if (status === 'skipped') return 'gray';
  return 'gray';
}
