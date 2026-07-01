'use client';
import { useState } from 'react';

export default function AccessForm({ initial }: { initial: { guestMode: boolean; adminContactPhone: string } }) {
  const [guestMode, setGuestMode] = useState(initial.guestMode);
  const [phone, setPhone] = useState(initial.adminContactPhone);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch('/api/settings/access', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestMode, adminContactPhone: phone.trim() || null }),
    });
    setBusy(false);
    setMsg(res.ok ? 'Saved' : `Error (${res.status})`);
  };

  return (
    <div className="space-y-4 border border-border rounded-lg p-4 bg-surface">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={guestMode} onChange={e => setGuestMode(e.target.checked)} />
        <span>Guest mode — allow public read-only access</span>
      </label>
      <label className="block text-sm">
        <span className="text-muted">Admin contact phone (WhatsApp) — receives access requests</span>
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="628123456789"
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono" />
      </label>
      <button disabled={busy} onClick={save} className="px-3 py-1.5 rounded bg-accent text-bg font-medium disabled:opacity-50">Save</button>
      {msg && <span className="ml-3 text-sm text-muted">{msg}</span>}
    </div>
  );
}
