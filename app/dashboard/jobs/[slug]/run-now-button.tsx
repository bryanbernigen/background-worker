'use client';
import { useState } from 'react';

export default function RunNowButton({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const trigger = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}/run`, { method: 'POST' });
    setBusy(false);
    if (res.ok) { setMsg('Run started — refresh history'); return; }
    if (res.status === 409) { setMsg('A run is already in progress'); return; }
    setMsg(`Error: ${res.status}`);
  };

  return (
    <div>
      <button disabled={busy} onClick={trigger}
        className="px-3 py-1.5 rounded bg-accent text-bg font-medium disabled:opacity-50">
        {busy ? 'Running…' : 'Run now'}
      </button>
      {msg && <div className="text-xs text-muted mt-1">{msg}</div>}
    </div>
  );
}
