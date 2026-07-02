'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LifecycleControls({ slug, archived }: { slug: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const post = async (action: 'archive' | 'unarchive') => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}/${action}`, { method: 'POST' });
    setBusy(false);
    if (res.ok) router.refresh();
    else setMsg(`Failed (${res.status})`);
  };

  const del = async () => {
    if (!confirm('Permanently delete this job and all its run history? This cannot be undone.')) return;
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}`, { method: 'DELETE' });
    if (res.ok) { router.push('/dashboard'); return; }
    setBusy(false); setMsg(`Delete failed (${res.status})`);
  };

  return (
    <div className="flex items-center gap-2">
      {archived ? (
        <>
          <button disabled={busy} onClick={() => post('unarchive')}
            className="text-sm px-3 py-1.5 rounded bg-accent text-bg font-medium disabled:opacity-50">Unarchive</button>
          <button disabled={busy} onClick={del}
            className="text-sm px-3 py-1.5 rounded border border-error/40 text-error hover:bg-error/10 disabled:opacity-50">Delete permanently</button>
        </>
      ) : (
        <button disabled={busy} onClick={() => post('archive')}
          className="text-sm px-3 py-1.5 rounded border border-border text-muted hover:bg-surface-2 disabled:opacity-50">Archive</button>
      )}
      {msg && <span className="text-sm text-error">{msg}</span>}
    </div>
  );
}
