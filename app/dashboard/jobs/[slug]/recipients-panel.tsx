'use client';
import { useEffect, useState } from 'react';

interface Recipient { id: number; name: string; phone: string }

interface Props {
  slug: string;
  /** Which recipient list this panel manages. Defaults to new-task alerts. */
  tag?: 'new-task' | 'cookie-expiry';
  title?: string;
  admin?: boolean;
}

export default function RecipientsPanel({ slug, tag = 'new-task', title = 'WhatsApp recipients', admin = true }: Props) {
  const [rows, setRows] = useState<Recipient[]>([]);
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<number, boolean>>({});

  const load = async () => {
    const res = await fetch(`/api/jobs/${slug}/recipients?tag=${tag}`);
    const body = await res.json();
    setRows(body.recipients ?? []);
    setDirty({});
  };
  useEffect(() => { void load(); }, [slug, tag]);

  const add = async () => {
    if (!name || !phone) return;
    const res = await fetch(`/api/jobs/${slug}/recipients`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, phone, tag }),
    });
    if (res.ok) { setName(''); setPhone(''); setMsg('Added'); void load(); }
    else setMsg(`Add failed: ${res.status}`);
  };

  const update = async (r: Recipient) => {
    const res = await fetch(`/api/jobs/${slug}/recipients/${r.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: r.name, phone: r.phone }),
    });
    setMsg(res.ok ? 'Saved' : `Save failed: ${res.status}`);
    if (res.ok) void load();
  };

  const del = async (id: number) => {
    if (!confirm('Delete this recipient?')) return;
    const res = await fetch(`/api/jobs/${slug}/recipients/${id}`, { method: 'DELETE' });
    if (res.ok) { setMsg('Deleted'); void load(); }
  };

  const test = async (id: number) => {
    setMsg('Sending test…');
    const res = await fetch(`/api/jobs/${slug}/recipients/${id}/test`, { method: 'POST' });
    setMsg(res.ok ? 'Test message sent ✓' : `Test failed: ${res.status}`);
  };

  return (
    <div className="border border-border rounded-lg bg-surface">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-sm text-muted">{rows.length} configured</span>
      </header>

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted">
          {admin ? 'No recipients yet. Add one below.' : 'No recipients.'}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <input
                className="bg-surface-2 border border-border rounded px-2 py-1 text-sm w-32 read-only:text-muted"
                value={r.name}
                placeholder="Name"
                readOnly={!admin}
                onChange={e => { setRows(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x)); setDirty(d => ({ ...d, [r.id]: true })); }}
              />
              <input
                className="bg-surface-2 border border-border rounded px-2 py-1 text-sm font-mono flex-1 min-w-[180px] read-only:text-muted"
                value={r.phone}
                placeholder="6281…"
                readOnly={!admin}
                onChange={e => { setRows(rs => rs.map((x, j) => j === i ? { ...x, phone: e.target.value } : x)); setDirty(d => ({ ...d, [r.id]: true })); }}
              />
              {admin && (
                <>
                  <button
                    onClick={() => update(r)}
                    disabled={!dirty[r.id]}
                    className="text-xs px-2 py-1 rounded bg-accent text-bg disabled:bg-surface-2 disabled:text-muted disabled:cursor-not-allowed"
                  >Save</button>
                  <button onClick={() => test(r.id)}
                    className="text-xs px-2 py-1 rounded border border-border hover:bg-surface-2">Test</button>
                  <button onClick={() => del(r.id)}
                    className="text-xs px-2 py-1 rounded border border-border text-error hover:bg-error/10">Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {admin && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-border bg-surface-2/40">
          <input
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
            className="bg-surface-2 border border-border rounded px-2 py-1 text-sm w-32"
          />
          <input
            placeholder="Phone (e.g. 6281234567890)"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="bg-surface-2 border border-border rounded px-2 py-1 text-sm font-mono flex-1 min-w-[180px]"
          />
          <button onClick={add} disabled={!name || !phone}
            className="text-xs px-3 py-1 rounded bg-accent text-bg disabled:bg-surface-2 disabled:text-muted">
            Add recipient
          </button>
        </div>
      )}

      {msg && <div className="px-4 py-2 text-sm text-muted border-t border-border">{msg}</div>}
    </div>
  );
}
