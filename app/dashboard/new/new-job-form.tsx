'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_SCHEDULE_FIELDS, scheduleFieldsToPayload, type ScheduleFieldsState } from '@/lib/ui/schedule-fields';

interface TypeOption { type: string; title: string }

export default function NewJobForm({ types }: { types: TypeOption[] }) {
  const router = useRouter();
  const [type, setType] = useState(types[0]?.type ?? '');
  const [name, setName] = useState('');
  const [visibleToGuest, setVisibleToGuest] = useState(true);
  const [sched, setSched] = useState<ScheduleFieldsState>(DEFAULT_SCHEDULE_FIELDS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setS = (patch: Partial<ScheduleFieldsState>) => setSched({ ...sched, ...patch });

  const submit = async () => {
    setBusy(true); setErr(null);
    const res = await fetch('/api/jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, name, visibleToGuest, schedule: scheduleFieldsToPayload(sched) }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { router.push(`/dashboard/jobs/${body.job.slug}`); return; }
    setBusy(false);
    setErr(typeof body.error === 'string' ? body.error : JSON.stringify(body.error ?? res.status));
  };

  return (
    <div className="space-y-4 border border-border rounded-lg p-4 bg-surface">
      <label className="block text-sm">
        <span className="text-muted">Type</span>
        <select value={type} onChange={e => setType(e.target.value)} className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1">
          {types.map(t => <option key={t.type} value={t.type}>{t.title}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-muted">Name</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. DataAnnotation (main)"
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1" />
      </label>

      <label className="block text-sm">
        <span className="text-muted">Schedule type</span>
        <select value={sched.scheduleType} onChange={e => setS({ scheduleType: e.target.value as ScheduleFieldsState['scheduleType'] })}
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1">
          <option value="window">Randomized window</option>
          <option value="interval">Fixed interval</option>
          <option value="cron">Cron</option>
        </select>
      </label>

      {sched.scheduleType === 'window' && (
        <div className="grid grid-cols-2 gap-3">
          <Num label="Min interval (s)" value={sched.minIntervalS} onChange={v => setS({ minIntervalS: v })} />
          <Num label="Max interval (s)" value={sched.maxIntervalS} onChange={v => setS({ maxIntervalS: v })} />
          <Num label="Active from (h)" value={sched.dayStartHour} onChange={v => setS({ dayStartHour: v })} />
          <Num label="Active to (h, excl.)" value={sched.dayEndHour} onChange={v => setS({ dayEndHour: v })} />
          <Num label="TZ offset (h)" value={sched.tzOffsetH} onChange={v => setS({ tzOffsetH: v })} />
        </div>
      )}
      {sched.scheduleType === 'interval' && (
        <Num label="Interval (s)" value={sched.intervalS} onChange={v => setS({ intervalS: v })} />
      )}
      {sched.scheduleType === 'cron' && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2 text-sm">
            <span className="text-muted">Cron expression</span>
            <input value={sched.cronExpr} onChange={e => setS({ cronExpr: e.target.value })} placeholder="0 9 * * *"
              className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono" />
          </label>
          <Num label="TZ offset (h)" value={sched.tzOffsetH} onChange={v => setS({ tzOffsetH: v })} />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={visibleToGuest} onChange={e => setVisibleToGuest(e.target.checked)} />
        <span className="text-muted">Visible to guests</span>
      </label>

      <button disabled={busy || !type || !name} onClick={submit}
        className="px-3 py-1.5 rounded bg-accent text-bg font-medium disabled:opacity-50">
        {busy ? 'Creating…' : 'Create & start'}
      </button>
      {err && <div className="text-sm text-error">{err}</div>}
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block text-sm">
      <span className="text-muted">{label}</span>
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
        className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1" />
    </label>
  );
}
