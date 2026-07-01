'use client';
import { useState } from 'react';

export default function TestButton({ disabled }: { disabled: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch('/api/settings/notifications/test', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? 'Test sent ✓' : (body.error ?? `Failed (${res.status})`));
  };
  return (
    <div>
      <button disabled={disabled || busy} onClick={send}
        className="px-3 py-1.5 rounded bg-accent text-bg font-medium disabled:opacity-50">
        {busy ? 'Sending…' : 'Send test'}
      </button>
      {msg && <span className="ml-3 text-muted">{msg}</span>}
    </div>
  );
}
