'use client';
import { useState } from 'react';

type Source = 'db' | 'env' | 'none';
interface Initial { url: string; urlSource: Source; apiKeyPreview: string | null; apiKeySource: Source; session: string }

function hint(source: Source): string {
  return source === 'db' ? 'set here' : source === 'env' ? 'from env fallback' : 'not set';
}

export default function WahaForm({ initial }: { initial: Initial }) {
  const [url, setUrl] = useState(initial.url);
  const [session, setSession] = useState(initial.session);
  const [apiKey, setApiKey] = useState(''); // blank = keep existing
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setMsg(null);
    const body: Record<string, unknown> = {
      wahaUrl: url.trim() || null,
      wahaSession: session.trim() || null,
    };
    if (apiKey.trim()) body.wahaApiKey = apiKey.trim(); // omit to keep existing
    const res = await fetch('/api/settings/notifications', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    setMsg(res.ok ? 'Saved — takes effect immediately' : `Error (${res.status})`);
    if (res.ok) setApiKey('');
  };

  return (
    <div className="space-y-4 border border-border rounded-lg p-4 bg-surface">
      <label className="block text-sm">
        <span className="text-muted">WAHA URL <span className="text-xs">({hint(initial.urlSource)})</span></span>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://waha.example.com"
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono" />
      </label>
      <label className="block text-sm">
        <span className="text-muted">API key <span className="text-xs">({hint(initial.apiKeySource)})</span></span>
        {initial.apiKeyPreview && <div className="mt-1 font-mono text-xs text-muted">current: {initial.apiKeyPreview}</div>}
        <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="leave blank to keep · paste to replace"
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono" />
      </label>
      <label className="block text-sm">
        <span className="text-muted">Session <span className="text-xs">({hint(initial.urlSource)})</span></span>
        <input value={session} onChange={e => setSession(e.target.value)} placeholder="default"
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono" />
      </label>
      <button disabled={busy} onClick={save} className="px-3 py-1.5 rounded bg-accent text-bg font-medium disabled:opacity-50">Save</button>
      {msg && <span className="ml-3 text-sm text-muted">{msg}</span>}
    </div>
  );
}
