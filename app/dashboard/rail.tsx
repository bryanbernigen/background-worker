'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import StatusDot from '@/components/ui/status-dot';
import ContactAdmin from './contact-admin';
import { filterJobs } from '@/lib/ui/filter-jobs';

interface RailJob { slug: string; title: string; type: string; scheduleType: string; visibleToGuest: boolean; status: string }

function JobLink({ j, active, muted, isAdmin }: { j: RailJob; active: boolean; muted?: boolean; isAdmin: boolean }) {
  return (
    <Link href={`/dashboard/jobs/${j.slug}`}
      className={`flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2 ${active ? 'bg-surface-2 border-l-2 border-accent' : 'border-l-2 border-transparent'} ${muted ? 'opacity-60' : ''}`}>
      <StatusDot status={muted ? 'idle' : j.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{j.title}</span>
        <span className="block truncate text-[11px] font-mono uppercase tracking-wide text-muted">{j.type} · {j.scheduleType}</span>
      </span>
      {isAdmin && !j.visibleToGuest && !muted && <span title="Hidden from guests">🔒</span>}
    </Link>
  );
}

export default function Rail({ active, archived, isAdmin, contactEnabled }: {
  active: RailJob[]; archived: RailJob[]; isAdmin: boolean; contactEnabled: boolean;
}) {
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const shownActive = filterJobs(active, q);
  const shownArchived = filterJobs(archived, q);

  return (
    <aside className="w-72 shrink-0 h-full border-r border-border bg-surface flex flex-col">
      <div className="px-4 py-4 flex items-center justify-between border-b border-border">
        <Link href="/dashboard" className="font-semibold tracking-tight">Background Worker</Link>
        {isAdmin && (
          <Link href="/dashboard/new" title="New job"
            className="w-7 h-7 grid place-items-center rounded border border-border text-accent hover:bg-surface-2">＋</Link>
        )}
      </div>

      <div className="px-3 py-2 border-b border-border">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search jobs…"
          className="w-full bg-surface-2 border border-border rounded px-2 py-1 text-sm placeholder:text-muted" />
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto py-2">
        <div className="px-4 py-1 text-[10px] font-mono uppercase tracking-wider text-muted">Jobs</div>
        {shownActive.length === 0 && <div className="px-4 py-3 text-sm text-muted">{q ? 'No matches.' : 'No jobs yet.'}</div>}
        {shownActive.map(j => (
          <JobLink key={j.slug} j={j} active={pathname === `/dashboard/jobs/${j.slug}`} isAdmin={isAdmin} />
        ))}

        {isAdmin && archived.length > 0 && (
          <div className="mt-2 border-t border-border pt-1">
            <button onClick={() => setShowArchived(v => !v)}
              className="w-full px-4 py-1 text-left text-[10px] font-mono uppercase tracking-wider text-muted hover:text-text">
              {showArchived ? '▾' : '▸'} Archived ({archived.length})
            </button>
            {showArchived && shownArchived.map(j => (
              <JobLink key={j.slug} j={j} active={pathname === `/dashboard/jobs/${j.slug}`} muted isAdmin={isAdmin} />
            ))}
            {showArchived && shownArchived.length === 0 && <div className="px-4 py-2 text-xs text-muted">No matches.</div>}
          </div>
        )}
      </nav>

      {isAdmin && (
        <div className="border-t border-border py-2">
          <div className="px-4 py-1 text-[10px] font-mono uppercase tracking-wider text-muted">Settings</div>
          <Link href="/dashboard/settings/notifications" className="block px-4 py-2 text-sm hover:bg-surface-2">Notifications</Link>
          <Link href="/dashboard/settings/access" className="block px-4 py-2 text-sm hover:bg-surface-2">Access</Link>
          <form action="/api/auth/logout" method="POST" className="px-4 py-2">
            <button className="text-xs text-muted hover:text-text">Logout</button>
          </form>
        </div>
      )}

      {contactEnabled && <div className="border-t border-border p-4"><ContactAdmin /></div>}
    </aside>
  );
}
