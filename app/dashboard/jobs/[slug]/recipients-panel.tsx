'use client';
import { useEffect, useState } from 'react';

interface Recipient { id: number; name: string; phone: string }

interface Props {
  slug: string;
  /** Which recipient list this panel manages. Defaults to project alerts. */
  kind?: 'project' | 'cookie';
  title?: string;
}

export default function RecipientsPanel({ slug, kind = 'project', title = 'WhatsApp recipients' }: Props) {
  const [rows, setRows] = useState<Recipient[]>([]);
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<number, boolean>>({});

  const load = async () => {
    const res = await fetch(`/api/jobs/${slug}/recipients?kind=${kind}`);
    const body = await res.json();
    setRows(body.recipients ?? []);
    setDirty({});
  };
  useEffect(() => { void load(); }, [slug, kind]);

  const add = async () => {
    if (!name || !phone) return;
    const res = await fetch(`/api/jobs/${slug}/recipients`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, phone, kind }),
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
    <div className="border rounded-lg bg-white shadow-sm">
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-sm text-gray-500">{rows.length} configured</span>
      </header>

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-500">
          No recipients yet. Add one below.
        </div>
      ) : (
        <ul className="divide-y">
          {rows.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <input
                className="border rounded px-2 py-1 text-sm w-32"
                value={r.name}
                placeholder="Name"
                onChange={e => { setRows(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x)); setDirty(d => ({ ...d, [r.id]: true })); }}
              />
              <input
                className="border rounded px-2 py-1 text-sm font-mono flex-1 min-w-[180px]"
                value={r.phone}
                placeholder="6281…"
                onChange={e => { setRows(rs => rs.map((x, j) => j === i ? { ...x, phone: e.target.value } : x)); setDirty(d => ({ ...d, [r.id]: true })); }}
              />
              <button
                onClick={() => update(r)}
                disabled={!dirty[r.id]}
                className="text-xs px-2 py-1 rounded border bg-blue-600 text-white disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
              >Save</button>
              <button onClick={() => test(r.id)}
                className="text-xs px-2 py-1 rounded border hover:bg-gray-50">Test</button>
              <button onClick={() => del(r.id)}
                className="text-xs px-2 py-1 rounded border text-red-700 hover:bg-red-50">Delete</button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t bg-gray-50">
        <input
          placeholder="Name"
          value={name}
          onChange={e => setName(e.target.value)}
          className="border rounded px-2 py-1 text-sm w-32 bg-white"
        />
        <input
          placeholder="Phone (e.g. 6281234567890)"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          className="border rounded px-2 py-1 text-sm font-mono flex-1 min-w-[180px] bg-white"
        />
        <button onClick={add} disabled={!name || !phone}
          className="text-xs px-3 py-1 rounded bg-green-600 text-white disabled:bg-gray-300">
          Add recipient
        </button>
      </div>

      {msg && <div className="px-4 py-2 text-sm text-gray-600 border-t">{msg}</div>}
    </div>
  );
}
