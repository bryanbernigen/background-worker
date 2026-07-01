import { redirect } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
import { externalServices, GITHUB_REPO_URL } from '@/lib/services';

export default async function DashboardHome() {
  const role = await resolveRole();
  if (!role) redirect('/');

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Background Worker</h1>
        <p className="text-muted mt-1">A 24/7 job runtime. Pick a job from the rail to inspect its runs, schedule, and recipients.</p>
      </div>

      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">Services &amp; Accounts</h2>
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface overflow-hidden">
          {externalServices.map(svc => (
            <li key={svc.name}>
              <a href={svc.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-2 transition-colors group">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-1.5">
                    {svc.name}
                    <span className="text-muted group-hover:text-accent transition-colors" aria-hidden>↗</span>
                  </div>
                  {svc.note && <div className="text-sm text-muted truncate">{svc.note}</div>}
                </div>
                <span className="shrink-0 text-xs px-2 py-1 rounded bg-surface-2 text-muted">{svc.account}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <BuildFooter />
    </div>
  );
}

function BuildFooter() {
  const commit = process.env.GIT_COMMIT;
  if (!commit || commit === 'unknown') {
    return <footer className="text-center text-xs text-muted">Background Worker</footer>;
  }
  return (
    <footer className="text-center text-xs text-muted">
      running{' '}
      <a href={`${GITHUB_REPO_URL}/commit/${commit}`} target="_blank" rel="noopener noreferrer"
        className="font-mono text-muted hover:text-accent hover:underline">{commit}</a>
    </footer>
  );
}
