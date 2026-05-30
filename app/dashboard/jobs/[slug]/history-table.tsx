'use client';
import { Fragment, useEffect, useState } from 'react';
import { formatDurationMs } from '@/lib/format-duration';

interface Row {
  id: number;
  startedAt: string; finishedAt: string;
  status: string; triggerType: string; skipReason: string | null; diffMs: number | null;
  paidProjects: number; allProjects: number;
  paidQualifications: number; allQualifications: number;
  newPaidProjects: number; newAllProjects: number;
  newPaidQualifications: number; newAllQualifications: number;
  notificationSent: boolean;
}

interface Detail extends Row {
  extractedItems: unknown[] | null;
  rawHtml: string | null;
  errorMessage: string | null;
}

type DetailState = Detail | 'loading' | undefined;

export default function HistoryTable({ slug }: { slug: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [open, setOpen] = useState<Record<number, DetailState>>({});
  const [loading, setLoading] = useState(false);

  const load = async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/jobs/${slug}/history?page=${p}&pageSize=${pageSize}`);
      const body = await res.json();
      setRows(body.rows ?? []); setTotal(body.total ?? 0);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(page); }, [slug, page]);

  const toggle = async (id: number) => {
    if (open[id]) { setOpen({ ...open, [id]: undefined }); return; }
    setOpen({ ...open, [id]: 'loading' });
    const res = await fetch(`/api/jobs/${slug}/history?detailId=${id}`);
    const body = await res.json();
    setOpen({ ...open, [id]: body.detail });
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="border rounded-lg bg-white shadow-sm">
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold">Run history</h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">{total} run{total === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-1">
            <PagerBtn disabled={page <= 1}      onClick={() => setPage(p => p - 1)}>‹</PagerBtn>
            <span className="px-2 text-gray-600">Page {page} / {pages}</span>
            <PagerBtn disabled={page >= pages} onClick={() => setPage(p => p + 1)}>›</PagerBtn>
          </div>
          <button onClick={() => load(page)} disabled={loading}
            className="text-xs px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-40">
            {loading ? '…' : 'refresh'}
          </button>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          {loading ? 'Loading…' : 'No runs yet — click "Run check now" to trigger one.'}
        </div>
      ) : (
        <ul className="divide-y">
          {rows.map(r => (
            <Fragment key={r.id}>
              <li
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                onClick={() => toggle(r.id)}
              >
                <StatusDot status={r.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm text-gray-800 font-medium">
                      {formatTime(r.startedAt)}
                    </span>
                    <span className={`text-xs uppercase tracking-wide ${triggerStyle(r.triggerType)}`}>
                      {r.triggerType}
                    </span>
                    {r.skipReason && (
                      <span className="text-xs text-gray-500">— {r.skipReason}</span>
                    )}
                    {r.notificationSent && (
                      <span className="text-xs text-green-700">📣 notified</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5 flex flex-wrap gap-x-4">
                    <Stat label="Projects" paid={r.paidProjects} total={r.allProjects} new_={r.newAllProjects} newPaid={r.newPaidProjects} />
                    <Stat label="Quals"    paid={r.paidQualifications} total={r.allQualifications} new_={r.newAllQualifications} newPaid={r.newPaidQualifications} />
                    {r.diffMs != null && <span className="text-gray-400">Δ {formatDurationMs(r.diffMs)}</span>}
                  </div>
                </div>
                <button className="text-blue-600 text-xs shrink-0">
                  {open[r.id] ? 'hide' : 'detail'}
                </button>
              </li>
              {open[r.id] === 'loading' && (
                <li className="px-4 py-2 text-xs text-gray-500">Loading detail…</li>
              )}
              {open[r.id] && open[r.id] !== 'loading' && (
                <li className="px-4 py-3 bg-gray-50 border-t border-b">
                  <DetailView detail={open[r.id] as Detail} />
                </li>
              )}
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ok' ? 'bg-green-500' :
    status === 'error' ? 'bg-red-500' :
    status === 'skipped' ? 'bg-gray-400' : 'bg-gray-300';
  return <span className={`shrink-0 inline-block w-2.5 h-2.5 rounded-full ${color}`} title={status} />;
}

function PagerBtn({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button disabled={disabled} onClick={onClick}
      className="w-6 h-6 rounded border text-sm flex items-center justify-center hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
      {children}
    </button>
  );
}

function Stat({ label, paid, total, new_, newPaid }: {
  label: string; paid: number; total: number; new_: number; newPaid: number;
}) {
  if (total === 0 && new_ === 0) return null;
  return (
    <span>
      <span className="text-gray-700">{label}:</span>{' '}
      <span className="font-mono">{paid}/{total}</span>
      {new_ > 0 && (
        <span className="ml-1 px-1.5 rounded text-[10px] bg-green-100 text-green-800 font-medium">
          +{newPaid}/{new_} new
        </span>
      )}
    </span>
  );
}

function triggerStyle(t: string): string {
  return t === 'manual' ? 'text-purple-700' : 'text-gray-500';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function DetailView({ detail }: { detail: Detail }) {
  return (
    <div className="space-y-2 text-xs">
      {detail.errorMessage && (
        <div className="text-red-700 bg-red-50 border border-red-200 rounded p-2 font-mono whitespace-pre-wrap">
          {detail.errorMessage}
        </div>
      )}
      {detail.extractedItems && (
        <details>
          <summary className="cursor-pointer text-gray-700 select-none">
            Extracted items <span className="text-gray-400">({(detail.extractedItems as unknown[]).length})</span>
          </summary>
          <pre className="overflow-auto max-h-80 mt-1 p-2 bg-white border rounded">{JSON.stringify(detail.extractedItems, null, 2)}</pre>
        </details>
      )}
      {detail.rawHtml && (
        <details>
          <summary className="cursor-pointer text-gray-700 select-none">
            Raw HTML <span className="text-gray-400">({detail.rawHtml.length} chars)</span>
          </summary>
          <pre className="overflow-auto max-h-80 mt-1 p-2 bg-white border rounded font-mono">{detail.rawHtml.slice(0, 5000)}</pre>
        </details>
      )}
    </div>
  );
}
