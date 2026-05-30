'use client';
import { useState } from 'react';

interface Initial { title: string; url: string; description: string }

export default function MetaForm({ slug, initial }: { slug: string; initial: Initial }) {
  const [meta, setMeta] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meta }),
    });
    setBusy(false);
    setMsg(res.ok ? 'Saved' : `Error: ${res.status}`);
  };

  return (
    <div className="border rounded p-4 space-y-3 bg-white">
      <h3 className="font-semibold">Job metadata</h3>
      <Field label="Title">
        <input className="w-full border rounded p-2" value={meta.title}
          onChange={e => setMeta({ ...meta, title: e.target.value })} />
      </Field>
      <Field label="URL">
        <input className="w-full border rounded p-2 font-mono text-sm" value={meta.url}
          onChange={e => setMeta({ ...meta, url: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea className="w-full border rounded p-2" rows={2} value={meta.description}
          onChange={e => setMeta({ ...meta, description: e.target.value })} />
      </Field>
      <button disabled={busy} onClick={save}
        className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">Save</button>
      {msg && <span className="ml-3 text-sm">{msg}</span>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-sm text-gray-600">{label}</span>{children}</label>;
}
