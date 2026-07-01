'use client';
import { useState } from 'react';

interface Initial { title: string; url: string; description: string }

export default function EditableHeader({ slug, initial }: { slug: string; initial: Initial }) {
  const [meta, setMeta] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startEdit = () => { setDraft(meta); setErr(null); setEditing(true); };
  const cancel = () => { setEditing(false); setErr(null); };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/jobs/${slug}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ meta: draft }),
      });
      if (res.ok) { setMeta(draft); setEditing(false); }
      else {
        const body = await res.json().catch(() => ({}));
        setErr(typeof body.error === 'string' ? body.error : `Save failed: ${res.status}`);
      }
    } finally { setBusy(false); }
  };

  if (!editing) {
    return (
      <div className="group flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{meta.title}</h1>
          <a href={meta.url} target="_blank" rel="noreferrer"
            className="block text-xs text-accent hover:underline font-mono break-all mt-0.5">
            {meta.url}
          </a>
          {meta.description && (
            <p className="text-sm text-muted mt-1">{meta.description}</p>
          )}
        </div>
        <button
          onClick={startEdit}
          className="shrink-0 text-xs px-2 py-1 rounded border border-border text-muted hover:bg-surface-2 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
          aria-label="Edit job metadata"
        >Edit</button>
      </div>
    );
  }

  return (
    <div className="space-y-2 border border-border rounded-lg bg-surface p-3">
      <div>
        <label className="block">
          <span className="text-xs text-muted">Title</span>
          <input
            className="w-full bg-surface-2 border border-border rounded px-2 py-1.5 text-lg font-bold"
            value={draft.title}
            onChange={e => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
      </div>
      <div>
        <label className="block">
          <span className="text-xs text-muted">URL</span>
          <input
            className="w-full bg-surface-2 border border-border rounded px-2 py-1 text-sm font-mono"
            value={draft.url}
            onChange={e => setDraft({ ...draft, url: e.target.value })}
          />
        </label>
      </div>
      <div>
        <label className="block">
          <span className="text-xs text-muted">Description</span>
          <textarea
            className="w-full bg-surface-2 border border-border rounded px-2 py-1 text-sm"
            rows={2}
            value={draft.description}
            onChange={e => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy}
          className="text-sm px-3 py-1 rounded bg-accent text-bg disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={cancel} disabled={busy}
          className="text-sm px-3 py-1 rounded border border-border hover:bg-surface-2">
          Cancel
        </button>
        {err && <span className="text-sm text-error">{err}</span>}
      </div>
    </div>
  );
}
