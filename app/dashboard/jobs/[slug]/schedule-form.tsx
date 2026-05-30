'use client';
import { useState } from 'react';
import { formatDurationS } from '@/lib/format-duration';

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
        <NumField label="Min interval" suffix="sec" hint={formatDurationS(s.minIntervalS)} value={s.minIntervalS}
          onChange={v => setS({ ...s, minIntervalS: v })} />
        <NumField label="Max interval" suffix="sec" hint={formatDurationS(s.maxIntervalS)} value={s.maxIntervalS}
          onChange={v => setS({ ...s, maxIntervalS: v })} />
        <NumField label="Active from" suffix="hour" hint={`${pad(s.dayStartHour)}:00 local`} value={s.dayStartHour}
          onChange={v => setS({ ...s, dayStartHour: v })} />
        <NumField label="Active to (exclusive)" suffix="hour" hint={`${pad(s.dayEndHour)}:00 local`} value={s.dayEndHour}
          onChange={v => setS({ ...s, dayEndHour: v })} />
        <NumField label="Timezone offset" suffix="hours" hint={`UTC${s.tzOffsetH >= 0 ? '+' : ''}${s.tzOffsetH}`} value={s.tzOffsetH}
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

function NumField({ label, suffix, hint, value, onChange }: {
  label: string; suffix: string; hint: string; value: number; onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" className="flex-1 border rounded p-2"
          value={value} onChange={e => onChange(Number(e.target.value))} />
        <span className="text-xs text-gray-400">{suffix}</span>
      </div>
      <div className="text-xs text-gray-500 mt-0.5">≈ {hint}</div>
    </label>
  );
}

function pad(n: number): string { return n.toString().padStart(2, '0'); }
