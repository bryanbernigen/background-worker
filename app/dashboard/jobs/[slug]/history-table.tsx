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

const COL_COUNT = 9;

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
    <div className="border rounded-lg bg-white shadow-sm overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3 border-b bg-gray-50">
        <div className="flex items-baseline gap-3">
          <h3 className="font-semibold">Run history</h3>
          <span className="text-sm text-gray-500">{total} run{total === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-1">
            <PagerBtn disabled={page <= 1}      onClick={() => setPage(p => p - 1)}>‹</PagerBtn>
            <span className="px-2 text-gray-600">Page {page} / {pages}</span>
            <PagerBtn disabled={page >= pages} onClick={() => setPage(p => p + 1)}>›</PagerBtn>
          </div>
          <button onClick={() => load(page)} disabled={loading}
            className="text-xs px-2.5 py-1.5 rounded border bg-white hover:bg-gray-100 disabled:opacity-40">
            {loading ? '…' : 'refresh'}
          </button>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-gray-500">
          {loading ? 'Loading…' : 'No runs yet — click "Run check now" to trigger one.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-gray-500 bg-gray-50/50">
              <tr>
                <Th>Time</Th>
                <Th>Status</Th>
                <Th>Trigger</Th>
                <Th className="text-right">Projects<br/><span className="font-normal normal-case text-[10px] text-gray-400">paid / all</span></Th>
                <Th className="text-right">Quals<br/><span className="font-normal normal-case text-[10px] text-gray-400">paid / all</span></Th>
                <Th className="text-right">New Proj<br/><span className="font-normal normal-case text-[10px] text-gray-400">paid / all</span></Th>
                <Th className="text-right">New Quals<br/><span className="font-normal normal-case text-[10px] text-gray-400">paid / all</span></Th>
                <Th className="text-right">Δ</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <Fragment key={r.id}>
                  <tr className="border-t hover:bg-gray-50 transition-colors">
                    <Td>
                      <div className="font-medium text-gray-800">{formatTime(r.startedAt)}</div>
                      <div className="text-xs text-gray-400">{formatDate(r.startedAt)}</div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusDot status={r.status} />
                        <span className={`text-sm ${statusTextColor(r.status)}`}>{r.status}</span>
                      </div>
                      {r.skipReason && (
                        <div className="text-xs text-gray-500 mt-0.5 ml-4">{r.skipReason}</div>
                      )}
                      {r.notificationSent && (
                        <div className="text-xs text-green-700 mt-0.5 ml-4">📣 notified</div>
                      )}
                    </Td>
                    <Td><TriggerBadge t={r.triggerType} /></Td>
                    <Td className="text-right font-mono">{r.paidProjects}<span className="text-gray-300">/</span>{r.allProjects}</Td>
                    <Td className="text-right font-mono">{r.paidQualifications}<span className="text-gray-300">/</span>{r.allQualifications}</Td>
                    <Td className="text-right font-mono">
                      <NewCount paid={r.newPaidProjects} all={r.newAllProjects} />
                    </Td>
                    <Td className="text-right font-mono">
                      <NewCount paid={r.newPaidQualifications} all={r.newAllQualifications} />
                    </Td>
                    <Td className="text-right text-gray-500 font-mono text-xs">
                      {r.diffMs != null ? formatDurationMs(r.diffMs) : '—'}
                    </Td>
                    <Td className="text-right">
                      <button onClick={() => toggle(r.id)}
                        className="text-xs text-blue-600 hover:underline">
                        {open[r.id] ? 'hide' : 'detail'}
                      </button>
                    </Td>
                  </tr>
                  {open[r.id] === 'loading' && (
                    <tr className="bg-gray-50">
                      <td colSpan={COL_COUNT} className="px-5 py-3 text-xs text-gray-500">Loading detail…</td>
                    </tr>
                  )}
                  {open[r.id] && open[r.id] !== 'loading' && (
                    <tr className="bg-gray-50/70">
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

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ok' ? 'bg-green-500' :
    status === 'error' ? 'bg-red-500' :
    status === 'skipped' ? 'bg-gray-400' : 'bg-gray-300';
  return <span className={`shrink-0 inline-block w-2.5 h-2.5 rounded-full ${color}`} />;
}

function statusTextColor(status: string): string {
  if (status === 'ok')      return 'text-green-700';
  if (status === 'error')   return 'text-red-700';
  if (status === 'skipped') return 'text-gray-500';
  return 'text-gray-600';
}

function TriggerBadge({ t }: { t: string }) {
  const cls = t === 'manual'
    ? 'bg-purple-100 text-purple-800'
    : 'bg-gray-100 text-gray-700';
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>{t}</span>;
}

function NewCount({ paid, all }: { paid: number; all: number }) {
  if (all === 0) return <span className="text-gray-300">—</span>;
  return (
    <span className="text-green-700 font-semibold">
      {paid}<span className="text-gray-400">/</span>{all}
    </span>
  );
}

function PagerBtn({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button disabled={disabled} onClick={onClick}
      className="w-7 h-7 rounded border bg-white text-sm flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed">
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
