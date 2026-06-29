import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { verifySessionToken } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { jobs, runHistory } from '@/lib/db/schema';
import { jobRegistry } from '@/lib/jobs/registry';
import { externalServices, GITHUB_REPO_URL } from '@/lib/services';
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
    inRegistry: jobRegistry.some(m => m.type === j.type),
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

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Services &amp; Accounts</h2>
          <Card className="!p-0 overflow-hidden">
            <ul className="divide-y">
              {externalServices.map(svc => (
                <li key={svc.name}>
                  <a
                    href={svc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 flex items-center gap-1.5">
                        {svc.name}
                        <span className="text-gray-300 group-hover:text-blue-500 transition-colors" aria-hidden>↗</span>
                      </div>
                      {svc.note && <div className="text-sm text-gray-500 truncate">{svc.note}</div>}
                    </div>
                    <span className="shrink-0 text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">{svc.account}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <BuildFooter />
      </div>
    </div>
  );
}

/** Subtle footer showing which commit this deploy is running, linked to GitHub. */
function BuildFooter() {
  const commit = process.env.GIT_COMMIT;
  if (!commit || commit === 'unknown') {
    return <footer className="mt-8 text-center text-xs text-gray-400">Auto Checker</footer>;
  }
  return (
    <footer className="mt-8 text-center text-xs text-gray-400">
      Auto Checker · running{' '}
      <a
        href={`${GITHUB_REPO_URL}/commit/${commit}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-gray-500 hover:text-blue-600 hover:underline"
      >{commit}</a>
    </footer>
  );
}

function badgeColor(status: string, inRegistry: boolean): 'green' | 'red' | 'orange' | 'gray' {
  if (!inRegistry) return 'orange';
  if (status === 'ok') return 'green';
  if (status === 'error') return 'red';
  if (status === 'skipped') return 'gray';
  return 'gray';
}
