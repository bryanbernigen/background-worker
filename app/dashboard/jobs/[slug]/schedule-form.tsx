'use client';
import { useState } from 'react';
import { formatDurationS } from '@/lib/format-duration';
import {
  scheduleFieldsFromJob, scheduleFieldsToSettings, type ScheduleFieldsState,
} from '@/lib/ui/schedule-fields';

interface Initial {
  scheduleType: string; minIntervalS: number; maxIntervalS: number;
  dayStartHour: number; dayEndHour: number; tzOffsetH: number;
  intervalS: number | null; cronExpr: string | null;
}

export default function ScheduleForm({ slug, initial }: { slug: string; initial: Initial }) {
  const [s, setS] = useState<ScheduleFieldsState>(scheduleFieldsFromJob(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}/settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedule: scheduleFieldsToSettings(s) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? 'Saved' : `Error: ${JSON.stringify(body.error ?? res.status)}`);
  };

  const set = (patch: Partial<ScheduleFieldsState>) => setS({ ...s, ...patch });

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-surface">
      <h3 className="font-semibold">Schedule</h3>
      <label className="block text-sm">
        <span className="text-muted">Type</span>
        <select value={s.scheduleType} onChange={e => set({ scheduleType: e.target.value as ScheduleFieldsState['scheduleType'] })}
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1">
          <option value="window">Randomized window</option>
          <option value="interval">Fixed interval</option>
          <option value="cron">Cron</option>
        </select>
      </label>

      {s.scheduleType === 'window' && (
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Min interval" suffix="sec" hint={formatDurationS(s.minIntervalS)} value={s.minIntervalS} onChange={v => set({ minIntervalS: v })} />
          <NumField label="Max interval" suffix="sec" hint={formatDurationS(s.maxIntervalS)} value={s.maxIntervalS} onChange={v => set({ maxIntervalS: v })} />
          <NumField label="Active from" suffix="hour" hint={`${pad(s.dayStartHour)}:00 local`} value={s.dayStartHour} onChange={v => set({ dayStartHour: v })} />
          <NumField label="Active to (excl.)" suffix="hour" hint={`${pad(s.dayEndHour)}:00 local`} value={s.dayEndHour} onChange={v => set({ dayEndHour: v })} />
          <NumField label="Timezone offset" suffix="hours" hint={`UTC${s.tzOffsetH >= 0 ? '+' : ''}${s.tzOffsetH}`} value={s.tzOffsetH} onChange={v => set({ tzOffsetH: v })} />
        </div>
      )}
      {s.scheduleType === 'interval' && (
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Interval" suffix="sec" hint={formatDurationS(s.intervalS)} value={s.intervalS} onChange={v => set({ intervalS: v })} />
        </div>
      )}
      {s.scheduleType === 'cron' && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2">
            <span className="text-sm text-muted">Cron expression</span>
            <input className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono"
              value={s.cronExpr} onChange={e => set({ cronExpr: e.target.value })} placeholder="0 9 * * *" />
          </label>
          <NumField label="Timezone offset" suffix="hours" hint={`UTC${s.tzOffsetH >= 0 ? '+' : ''}${s.tzOffsetH}`} value={s.tzOffsetH} onChange={v => set({ tzOffsetH: v })} />
        </div>
      )}

      <button disabled={busy} onClick={save} className="px-3 py-1.5 rounded bg-accent text-bg disabled:opacity-50">Save</button>
      {msg && <span className="ml-3 text-sm text-muted">{msg}</span>}
    </div>
  );
}

function NumField({ label, suffix, hint, value, onChange }: {
  label: string; suffix: string; hint: string; value: number; onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" className="flex-1 bg-surface-2 border border-border rounded p-2"
          value={value} onChange={e => onChange(Number(e.target.value))} />
        <span className="text-xs text-muted">{suffix}</span>
      </div>
      <div className="text-xs text-muted mt-0.5">≈ {hint}</div>
    </label>
  );
}

function pad(n: number): string { return n.toString().padStart(2, '0'); }
