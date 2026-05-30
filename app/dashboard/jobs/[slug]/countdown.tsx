'use client';
import { useEffect, useRef, useState } from 'react';
import { formatDurationS } from '@/lib/format-duration';

interface JobSnapshot {
  nextRunAt: string | null;
  lastRunAt: string | null;
  minIntervalS: number;
  maxIntervalS: number;
}

export default function Countdown({ slug, initial }: { slug: string; initial: JobSnapshot }) {
  const [snapshot, setSnapshot] = useState<JobSnapshot>(initial);
  const [now, setNow] = useState(() => Date.now());
  const lastKnownRunAt = useRef<string | null>(initial.lastRunAt);

  // Local clock tick — 1s.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Server poll — every 3s. Detects run completion (lastRunAt changes) and
  // refreshes nextRunAt for the cursor/countdown.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${slug}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const j = body.job as JobSnapshot;
        setSnapshot(s => ({
          nextRunAt: j.nextRunAt, lastRunAt: j.lastRunAt,
          minIntervalS: j.minIntervalS, maxIntervalS: j.maxIntervalS,
        }));
        lastKnownRunAt.current = j.lastRunAt;
      } catch { /* swallow */ }
    };
    const t = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [slug]);

  const lastRunMs = snapshot.lastRunAt ? new Date(snapshot.lastRunAt).getTime() : null;
  const nextRunMs = snapshot.nextRunAt ? new Date(snapshot.nextRunAt).getTime() : null;
  const elapsedSinceLastS = lastRunMs ? Math.max(0, (now - lastRunMs) / 1000) : 0;
  const remainingToNextS  = nextRunMs ? (nextRunMs - now) / 1000 : null;

  const isRunning = nextRunMs != null && now > nextRunMs;

  return (
    <div className="space-y-2">
      <ProgressBar
        elapsedS={elapsedSinceLastS}
        minS={snapshot.minIntervalS}
        maxS={snapshot.maxIntervalS}
        scheduledAtS={lastRunMs && nextRunMs ? (nextRunMs - lastRunMs) / 1000 : null}
        running={isRunning}
      />
      <div className="text-sm text-gray-600 text-right">
        {isRunning && nextRunMs ? (
          <span className="text-amber-700">Running for <strong>{formatDurationS((now - nextRunMs) / 1000)}</strong>…</span>
        ) : remainingToNextS !== null && remainingToNextS > 0 ? (
          <span>Next run in <strong>{formatDurationS(remainingToNextS)}</strong></span>
        ) : (
          <span className="text-gray-500">No next run scheduled</span>
        )}
      </div>
    </div>
  );
}

interface BarProps {
  elapsedS: number;
  minS: number;
  maxS: number;
  scheduledAtS: number | null;
  running: boolean;
}

function ProgressBar({ elapsedS, minS, maxS, scheduledAtS, running }: BarProps) {
  const span = Math.max(maxS, 1);
  const cursorPct = Math.min(100, (elapsedS / span) * 100);
  const minPct = Math.min(100, (minS / span) * 100);
  const schedPct = scheduledAtS != null ? Math.min(100, (scheduledAtS / span) * 100) : null;

  return (
    <div className="space-y-1">
      <div className="relative w-64 h-3 rounded-full bg-gray-200 overflow-visible">
        {/* Permitted-run window [min, max] */}
        <div
          className="absolute top-0 bottom-0 bg-blue-100 rounded-full"
          style={{ left: `${minPct}%`, right: `0%` }}
          title={`min=${minS}s, max=${maxS}s`}
        />
        {/* min tick */}
        <div
          className="absolute -top-1 -bottom-1 w-px bg-blue-500"
          style={{ left: `${minPct}%` }}
          title={`min interval`}
        />
        {/* max tick at right edge */}
        <div className="absolute -top-1 -bottom-1 right-0 w-px bg-blue-500" title="max interval" />
        {/* scheduled-next-run marker */}
        {schedPct != null && (
          <div
            className="absolute -top-1.5 -bottom-1.5 w-0.5 bg-green-600"
            style={{ left: `${schedPct}%` }}
            title="scheduled next run"
          />
        )}
        {/* moving cursor */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow ${
            running ? 'bg-amber-500 animate-pulse' : 'bg-gray-700'
          }`}
          style={{ left: `calc(${cursorPct}% - 6px)` }}
          title="now"
        />
      </div>
      <div className="flex justify-between text-[10px] text-gray-500 w-64 font-mono">
        <span>0</span>
        <span style={{ marginLeft: `${minPct}%` }} className="-translate-x-1/2">min {formatDurationS(minS)}</span>
        <span>max {formatDurationS(maxS)}</span>
      </div>
    </div>
  );
}
