'use client';
import { Fragment, useEffect, useState } from 'react';
import { formatDurationMs } from '@/lib/format-duration';
import StatusDot from '@/components/ui/status-dot';

interface Row {
  id: number;
  startedAt: string; finishedAt: string;
  status: string; triggerType: string; skipReason: string | null; diffMs: number | null;
  summary: string;
  notificationSent: boolean;
}

interface Detail extends Row {
  data: unknown;
  rawHtml: string | null;
  errorMessage: string | null;
}

type DetailState = Detail | 'loading' | undefined;
type NotifiedFilter = 'all' | 'yes' | 'no';
type StatusFilter   = 'all' | 'ok' | 'error' | 'skipped';
type TriggerFilter  = 'all' | 'scheduled' | 'manual';

const COL_COUNT = 6;

export default function HistoryTable({ slug }: { slug: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [notified, setNotified] = useState<NotifiedFilter>('all');
  const [status, setStatus]     = useState<StatusFilter>('all');
  const [trigger, setTrigger]   = useState<TriggerFilter>('all');
  const pageSize = 25;
  const [open, setOpen] = useState<Record<number, DetailState>>({});
  const [loading, setLoading] = useState(false);

  const load = async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (notified !== 'all') params.set('notified', notified);
      if (status !== 'all')   params.set('status', status);
      if (trigger !== 'all')  params.set('trigger', trigger);
      const res = await fetch(`/api/jobs/${slug}/history?${params}`);
      const body = await res.json();
      setRows(body.rows ?? []); setTotal(body.total ?? 0);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(page); }, [slug, page, notified, status, trigger]);

  // Changing any filter resets to page 1 (the load happens via the effect above).
  const onFilter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const filtersActive = notified !== 'all' || status !== 'all' || trigger !== 'all';
  const resetFilters = () => { setNotified('all'); setStatus('all'); setTrigger('all'); setPage(1); };

  const toggle = async (id: number) => {
    if (open[id]) { setOpen({ ...open, [id]: undefined }); return; }
    setOpen({ ...open, [id]: 'loading' });
    const res = await fetch(`/api/jobs/${slug}/history?detailId=${id}`);
    const body = await res.json();
    setOpen({ ...open, [id]: body.detail });
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="border border-border rounded-lg bg-surface overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-2">
        <div className="flex items-baseline gap-3">
          <h3 className="font-semibold">Run history</h3>
          <span className="text-sm text-muted">
            {total}{filtersActive ? ' matching' : ''} run{total === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-1">
            <PagerBtn disabled={page <= 1}      onClick={() => setPage(p => p - 1)}>‹</PagerBtn>
            <span className="px-2 text-muted">Page {page} / {pages}</span>
            <PagerBtn disabled={page >= pages} onClick={() => setPage(p => p + 1)}>›</PagerBtn>
          </div>
          <button onClick={() => load(page)} disabled={loading}
            className="text-xs px-2.5 py-1.5 rounded border border-border bg-surface hover:bg-surface-2 disabled:opacity-40">
            {loading ? '…' : 'refresh'}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-border bg-surface-2/40">
        <span className="text-xs font-mono uppercase tracking-wider text-muted mr-1">Filter</span>
        <FilterSelect label="Notified" value={notified} onChange={onFilter(setNotified)} options={[
          ['all', 'All'], ['yes', '📣 Notified'], ['no', 'Not notified'],
        ]} />
        <FilterSelect label="Status" value={status} onChange={onFilter(setStatus)} options={[
          ['all', 'All statuses'], ['ok', 'OK'], ['error', 'Error'], ['skipped', 'Skipped'],
        ]} />
        <FilterSelect label="Trigger" value={trigger} onChange={onFilter(setTrigger)} options={[
          ['all', 'All triggers'], ['scheduled', 'Scheduled'], ['manual', 'Manual'],
        ]} />
        {filtersActive && (
          <button onClick={resetFilters} className="text-xs text-accent hover:underline ml-1">
            clear filters
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-muted">
          {loading ? 'Loading…' : 'No runs yet — trigger one with Run now.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-mono uppercase tracking-wider text-muted bg-surface-2/50">
              <tr>
                <Th>Time</Th>
                <Th>Status</Th>
                <Th>Trigger</Th>
                <Th>Result</Th>
                <Th className="text-right">Δ</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <Fragment key={r.id}>
                  <tr className="border-t border-border hover:bg-surface-2 transition-colors">
                    <Td>
                      <div className="font-medium text-text">{formatTime(r.startedAt)}</div>
                      <div className="text-xs text-muted">{formatDate(r.startedAt)}</div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusDot status={r.status} />
                        <span className="text-sm" style={{ color: statusTextColor(r.status) }}>{r.status}</span>
                      </div>
                      {r.skipReason && (
                        <div className="text-xs text-muted mt-0.5 ml-4">{r.skipReason}</div>
                      )}
                      {r.notificationSent && (
                        <div className="text-xs text-ok mt-0.5 ml-4">📣 notified</div>
                      )}
                    </Td>
                    <Td><TriggerBadge t={r.triggerType} /></Td>
                    <Td className="text-sm text-muted whitespace-pre-line">{r.summary}</Td>
                    <Td className="text-right text-muted font-mono text-xs">
                      {r.diffMs != null ? formatDurationMs(r.diffMs) : '—'}
                    </Td>
                    <Td className="text-right">
                      <button onClick={() => toggle(r.id)}
                        className="text-xs text-accent hover:underline">
                        {open[r.id] ? 'hide' : 'detail'}
                      </button>
                    </Td>
                  </tr>
                  {open[r.id] === 'loading' && (
                    <tr className="bg-surface-2">
                      <td colSpan={COL_COUNT} className="px-5 py-3 text-xs text-muted">Loading detail…</td>
                    </tr>
                  )}
                  {open[r.id] && open[r.id] !== 'loading' && (
                    <tr className="bg-surface-2/70">
                      <td colSpan={COL_COUNT} className="px-5 py-4">
                        <DetailView detail={open[r.id] as Detail} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-5 py-3 font-semibold ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-5 py-3.5 align-top ${className}`}>{children}</td>;
}

function statusTextColor(status: string): string {
  if (status === 'ok')      return 'var(--color-ok)';
  if (status === 'error')   return 'var(--color-error)';
  if (status === 'skipped') return 'var(--color-warn)';
  return 'var(--color-muted)';
}

function TriggerBadge({ t }: { t: string }) {
  const cls = t === 'manual'
    ? 'bg-accent/20 text-accent'
    : 'bg-off/20 text-muted';
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>{t}</span>;
}

function FilterSelect<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  const active = value !== 'all';
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        className={`text-xs rounded-md border px-2 py-1 bg-surface-2 cursor-pointer transition-colors ${
          active ? 'border-accent text-accent font-medium' : 'border-border text-muted'
        }`}
      >
        {options.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
      </select>
    </label>
  );
}

function PagerBtn({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button disabled={disabled} onClick={onClick}
      className="w-7 h-7 rounded border border-border bg-surface text-sm flex items-center justify-center hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed">
      {children}
    </button>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function formatDate(iso: string): string {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  if (sameDay) return 'today';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function DetailView({ detail }: { detail: Detail }) {
  const items = (detail.data as { items?: unknown[] } | null)?.items ?? null;
  return (
    <div className="space-y-2 text-xs">
      {detail.errorMessage && (
        <div className="text-error bg-error/10 border border-error/30 rounded p-2 font-mono whitespace-pre-wrap">
          {detail.errorMessage}
        </div>
      )}
      {detail.data != null && (
        <details>
          <summary className="cursor-pointer text-muted select-none">
            Run data{items ? <span className="text-muted"> ({items.length} items)</span> : null}
          </summary>
          <pre className="overflow-auto max-h-80 mt-1 p-2 bg-bg border border-border rounded">{JSON.stringify(detail.data, null, 2)}</pre>
        </details>
      )}
      {detail.rawHtml && (
        <details>
          <summary className="cursor-pointer text-muted select-none">
            Raw HTML <span className="text-muted">({detail.rawHtml.length} chars)</span>
          </summary>
          <pre className="overflow-auto max-h-80 mt-1 p-2 bg-bg border border-border rounded font-mono">{detail.rawHtml.slice(0, 5000)}</pre>
        </details>
      )}
    </div>
  );
}
