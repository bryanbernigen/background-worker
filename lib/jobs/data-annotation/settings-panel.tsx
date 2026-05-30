'use client';
import { useEffect, useState } from 'react';

interface Props { jobId: number; current: unknown }

export default function DASettingsPanel({ current }: Props) {
  const c = (current ?? {}) as { cookie_preview?: string };
  const [stored, setStored] = useState<string | undefined>(c.cookie_preview);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState<string | null>(null);

  // Refresh stored preview after saves so the front/back display updates without page reload.
  const refresh = async () => {
    try {
      const res = await fetch(`/api/jobs/data-annotation`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      const preview = body?.job?.custom?.cookie_preview;
      setStored(typeof preview === 'string' ? preview : undefined);
    } catch { /* swallow */ }
  };

  useEffect(() => { setStored(c.cookie_preview); }, [c.cookie_preview]);

  const save = async () => {
    if (!value) return;
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/data-annotation/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ custom: { cookie: value } }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg('Cookie updated');
      setValue('');
      await refresh();
    } else {
      setMsg(`Error: ${res.status}`);
    }
  };

  return (
    <div className="space-y-3 border rounded p-4 bg-white">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">DataAnnotation cookie</h3>
        {stored && <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">stored</span>}
      </div>

      {stored ? (
        <StoredCookieView preview={stored} />
      ) : (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          No cookie configured yet. Paste your session cookie below to enable scraping.
        </div>
      )}

      <label className="block">
        <span className="text-sm text-gray-600">{stored ? 'Replace with new cookie' : 'Paste session cookie'}</span>
        <textarea
          className="w-full border rounded p-2 text-sm font-mono mt-1"
          rows={3}
          placeholder="session=...; other=..."
          value={value}
          onChange={e => setValue(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          disabled={busy || !value}
          onClick={save}
          className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50"
        >{stored ? 'Update cookie' : 'Save cookie'}</button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}

/** Splits the preview string like "abcd…wxyz (50 chars)" into front + back parts for prominent display. */
function StoredCookieView({ preview }: { preview: string }) {
  // The server-formatted preview is `${front4}…${back4} (${N} chars)`.
  const m = preview.match(/^(.+?)…(.+?) \((\d+) chars\)$/);
  if (!m) {
    // Fallback if format changes.
    return <div className="font-mono text-sm bg-gray-50 border rounded p-2 break-all">{preview}</div>;
  }
  const [, front, back, lenStr] = m;
  const totalLen = parseInt(lenStr, 10);
  const maskLen = Math.max(8, totalLen - front.length - back.length);
  const mask = '•'.repeat(Math.min(32, maskLen)); // cap visual mask length
  return (
    <div className="font-mono text-sm bg-gray-50 border rounded p-2 break-all">
      <span className="text-gray-800">{front}</span>
      <span className="text-gray-400" title={`${maskLen} hidden chars`}>{mask}</span>
      <span className="text-gray-800">{back}</span>
      <span className="text-xs text-gray-500 ml-2">({totalLen} chars total)</span>
    </div>
  );
}
