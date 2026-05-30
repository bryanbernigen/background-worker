'use client';
import { Fragment, useEffect, useState } from 'react';

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

  const load = async (p: number) => {
    const res = await fetch(`/api/jobs/${slug}/history?page=${p}&pageSize=${pageSize}`);
    const body = await res.json();
    setRows(body.rows ?? []); setTotal(body.total ?? 0);
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
    <div className="border rounded p-4 space-y-3 bg-white">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Run history ({total})</h3>
        <div className="text-sm">
          <button disabled={page <= 1}      onClick={() => setPage(p => p - 1)} className="px-2 disabled:opacity-30">‹</button>
          <span>Page {page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-2 disabled:opacity-30">›</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500">
            <tr>
              <th>When</th><th>Status</th><th>Trigger</th>
              <th>Projects (paid/all)</th><th>Quals (paid/all)</th>
              <th>New Proj (paid/all)</th><th>New Quals (paid/all)</th>
              <th>Δ</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <Fragment key={r.id}>
                <tr className="border-t">
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                  <td>
                    <span className={statusClass(r.status)}>{r.status}</span>
                    {r.skipReason && <span className="text-xs text-gray-500"> ({r.skipReason})</span>}
                  </td>
                  <td>{r.triggerType}</td>
                  <td>{r.paidProjects}/{r.allProjects}</td>
                  <td>{r.paidQualifications}/{r.allQualifications}</td>
                  <td>{r.newPaidProjects}/{r.newAllProjects}</td>
                  <td>{r.newPaidQualifications}/{r.newAllQualifications}</td>
                  <td>{r.diffMs != null ? `${Math.round(r.diffMs / 1000)}s` : '—'}</td>
                  <td><button onClick={() => toggle(r.id)} className="text-blue-600 text-xs">
                    {open[r.id] ? 'hide' : 'detail'}
                  </button></td>
                </tr>
                {open[r.id] === 'loading' && (
                  <tr><td colSpan={9} className="text-xs text-gray-500 p-2">Loading…</td></tr>
                )}
                {open[r.id] && open[r.id] !== 'loading' && (
                  <tr><td colSpan={9} className="bg-gray-50 p-2">
                    <DetailView detail={open[r.id] as Detail} />
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function statusClass(s: string): string {
  if (s === 'ok')      return 'text-green-700';
  if (s === 'error')   return 'text-red-700';
  if (s === 'skipped') return 'text-gray-500';
  return '';
}

function DetailView({ detail }: { detail: Detail }) {
  return (
    <div className="space-y-2 text-xs">
      {detail.errorMessage && <div className="text-red-700">Error: {detail.errorMessage}</div>}
      {detail.extractedItems && (
        <details>
          <summary className="cursor-pointer">Extracted items ({(detail.extractedItems as unknown[]).length})</summary>
          <pre className="overflow-auto max-h-80">{JSON.stringify(detail.extractedItems, null, 2)}</pre>
        </details>
      )}
      {detail.rawHtml && (
        <details>
          <summary className="cursor-pointer">Raw HTML ({detail.rawHtml.length} chars)</summary>
          <pre className="overflow-auto max-h-80 font-mono">{detail.rawHtml.slice(0, 5000)}</pre>
        </details>
      )}
    </div>
  );
}
