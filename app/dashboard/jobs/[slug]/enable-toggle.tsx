'use client';
import { useState } from 'react';

export default function EnableToggle({ slug, initialEnabled }: { slug: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async () => {
    const next = !enabled;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/jobs/${slug}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schedule: { enabled: next } }),
      });
      if (res.ok) setEnabled(next);
      else setErr(`Failed: ${res.status}`);
    } catch {
      setErr('Network error');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={toggle}
        disabled={busy}
        className={`px-3 py-1.5 rounded text-white text-sm font-medium disabled:opacity-50 ${
          enabled ? 'bg-gray-600 hover:bg-gray-700' : 'bg-green-600 hover:bg-green-700'
        }`}
        title={enabled ? 'Pause the schedule (no automatic runs)' : 'Resume the schedule'}
      >
        {busy ? '…' : enabled ? 'Disable job' : 'Enable job'}
      </button>
      <span className={`text-xs ${enabled ? 'text-green-700' : 'text-gray-500'}`}>
        {enabled ? '● scheduled' : '○ paused'}
      </span>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
