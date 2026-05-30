'use client';
import { useState } from 'react';

interface Initial {
  minIntervalS: number; maxIntervalS: number;
  dayStartHour: number; dayEndHour: number; tzOffsetH: number;
  enabled: boolean;
}

export default function ScheduleForm({ slug, initial }: { slug: string; initial: Initial }) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedule: s }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? 'Saved' : `Error: ${JSON.stringify(body.error ?? res.status)}`);
  };

  return (
    <div className="border rounded p-4 space-y-3 bg-white">
      <h3 className="font-semibold">Schedule</h3>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Min interval (sec)" value={s.minIntervalS}
          onChange={v => setS({ ...s, minIntervalS: v })} />
        <NumField label="Max interval (sec)" value={s.maxIntervalS}
          onChange={v => setS({ ...s, maxIntervalS: v })} />
        <NumField label="Active from (local hour 0–23)" value={s.dayStartHour}
          onChange={v => setS({ ...s, dayStartHour: v })} />
        <NumField label="Active to (local hour, exclusive)" value={s.dayEndHour}
          onChange={v => setS({ ...s, dayEndHour: v })} />
        <NumField label="Timezone offset (hours from UTC)" value={s.tzOffsetH}
          onChange={v => setS({ ...s, tzOffsetH: v })} />
        <label className="flex items-end gap-2">
          <input type="checkbox" checked={s.enabled} onChange={e => setS({ ...s, enabled: e.target.checked })} />
          <span className="text-sm">Enabled</span>
        </label>
      </div>
      <button disabled={busy} onClick={save}
        className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">Save</button>
      {msg && <span className="ml-3 text-sm">{msg}</span>}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <span className="text-sm text-gray-600">{label}</span>
      <input type="number" className="w-full border rounded p-2"
        value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}
