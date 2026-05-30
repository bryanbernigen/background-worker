'use client';
import { useState } from 'react';

interface Props { jobId: number; current: unknown }

export default function DASettingsPanel({ current }: Props) {
  const c = (current ?? {}) as { cookie_preview?: string };
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/data-annotation/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ custom: { cookie: value } }),
    });
    setBusy(false);
    setMsg(res.ok ? 'Saved' : `Error: ${res.status}`);
    if (res.ok) setValue('');
  };

  return (
    <div className="space-y-3 border rounded p-4">
      <h3 className="font-semibold">DataAnnotation cookie</h3>
      {c.cookie_preview && (
        <div className="text-sm text-gray-600">Stored: <code>{c.cookie_preview}</code></div>
      )}
      <textarea
        className="w-full border rounded p-2 text-sm font-mono"
        rows={3}
        placeholder="Paste full session cookie..."
        value={value}
        onChange={e => setValue(e.target.value)}
      />
      <button
        disabled={busy || !value}
        onClick={save}
        className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50"
      >Save cookie</button>
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
