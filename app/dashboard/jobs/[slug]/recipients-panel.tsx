'use client';
import { useEffect, useState } from 'react';

interface Recipient { id: number; name: string; phone: string }

export default function RecipientsPanel({ slug }: { slug: string }) {
  const [rows, setRows] = useState<Recipient[]>([]);
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch(`/api/jobs/${slug}/recipients`);
    const body = await res.json();
    setRows(body.recipients ?? []);
  };
  useEffect(() => { void load(); }, [slug]);

  const add = async () => {
    if (!name || !phone) return;
    const res = await fetch(`/api/jobs/${slug}/recipients`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    });
    if (res.ok) { setName(''); setPhone(''); void load(); }
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
    if (res.ok) void load();
  };

  const test = async (id: number) => {
    const res = await fetch(`/api/jobs/${slug}/recipients/${id}/test`, { method: 'POST' });
    setMsg(res.ok ? 'Test sent' : `Test failed: ${res.status}`);
  };

  return (
    <div className="border rounded p-4 space-y-3 bg-white">
      <h3 className="font-semibold">WhatsApp recipients</h3>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.id} className="flex gap-2 items-center">
            <input className="border rounded p-1.5 flex-1" value={r.name}
              onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input className="border rounded p-1.5 flex-1 font-mono text-sm" value={r.phone}
              onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} />
            <button onClick={() => update(r)} className="px-2 py-1 rounded bg-blue-600 text-white text-sm">Save</button>
            <button onClick={() => test(r.id)} className="px-2 py-1 rounded bg-gray-600 text-white text-sm">Test</button>
            <button onClick={() => del(r.id)}  className="px-2 py-1 rounded bg-red-600  text-white text-sm">Delete</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t pt-3">
        <input placeholder="Name"  value={name}  onChange={e => setName(e.target.value)}
          className="border rounded p-1.5 flex-1" />
        <input placeholder="Phone (E.164)" value={phone} onChange={e => setPhone(e.target.value)}
          className="border rounded p-1.5 flex-1 font-mono text-sm" />
        <button onClick={add} className="px-3 py-1.5 rounded bg-green-600 text-white text-sm">Add</button>
      </div>
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
