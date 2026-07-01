'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import StatusDot from '@/components/ui/status-dot';
import ContactAdmin from './contact-admin';

interface RailJob { slug: string; title: string; type: string; scheduleType: string; visibleToGuest: boolean; status: string }

export default function Rail({ jobs, isAdmin, contactEnabled }: { jobs: RailJob[]; isAdmin: boolean; contactEnabled: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="w-72 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="px-4 py-4 flex items-center justify-between border-b border-border">
        <Link href="/dashboard" className="font-semibold tracking-tight">Background Worker</Link>
        {isAdmin && (
          <Link href="/dashboard/new" title="New job"
            className="w-7 h-7 grid place-items-center rounded border border-border text-accent hover:bg-surface-2">＋</Link>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <div className="px-4 py-1 text-[10px] font-mono uppercase tracking-wider text-muted">Jobs</div>
        {jobs.length === 0 && <div className="px-4 py-3 text-sm text-muted">No jobs yet.</div>}
        {jobs.map(j => {
          const active = pathname === `/dashboard/jobs/${j.slug}`;
          return (
            <Link key={j.slug} href={`/dashboard/jobs/${j.slug}`}
              className={`flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2 ${active ? 'bg-surface-2 border-l-2 border-accent' : 'border-l-2 border-transparent'}`}>
              <StatusDot status={j.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{j.title}</span>
                <span className="block truncate text-[11px] font-mono uppercase tracking-wide text-muted">{j.type} · {j.scheduleType}</span>
              </span>
              {isAdmin && !j.visibleToGuest && <span title="Hidden from guests">🔒</span>}
            </Link>
          );
        })}
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

      {contactEnabled && (
        <div className="border-t border-border p-4"><ContactAdmin /></div>
      )}
    </aside>
  );
}
