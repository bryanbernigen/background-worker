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

  // Local clock — 1s tick drives the visible animation.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Server poll — 3s. Picks up new nextRunAt after a run completes.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${slug}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const j = body.job as JobSnapshot;
        setSnapshot({
          nextRunAt: j.nextRunAt, lastRunAt: j.lastRunAt,
          minIntervalS: j.minIntervalS, maxIntervalS: j.maxIntervalS,
        });
        lastKnownRunAt.current = j.lastRunAt;
      } catch { /* swallow */ }
    };
    const t = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [slug]);

  const nextRunMs = snapshot.nextRunAt ? new Date(snapshot.nextRunAt).getTime() : null;
  const lastRunMs = snapshot.lastRunAt ? new Date(snapshot.lastRunAt).getTime() : null;
  const remainingS = nextRunMs ? (nextRunMs - now) / 1000 : null;
  const isRunning = nextRunMs != null && now > nextRunMs;
  // The actual span chosen for THIS run (last → next). Drives the fill so the
  // bar reaches 0 exactly when the run fires. Falls back to maxIntervalS when
  // there is no prior run yet.
  const spanS = lastRunMs && nextRunMs ? Math.max(1, (nextRunMs - lastRunMs) / 1000) : snapshot.maxIntervalS;

  return (
    <div className="flex-1 min-w-0">
      <ProgressBar
        remainingS={remainingS}
        spanS={spanS}
        minS={snapshot.minIntervalS}
        maxS={snapshot.maxIntervalS}
        running={isRunning}
      />
      <div className="mt-1.5 text-sm flex items-center justify-between gap-3">
        {isRunning && nextRunMs ? (
          <span className="text-amber-700">
            Running for <strong>{formatDurationS((now - nextRunMs) / 1000)}</strong>…
          </span>
        ) : remainingS !== null && remainingS > 0 ? (
          <span className="text-gray-700">
            Next run in <strong>{formatDurationS(remainingS)}</strong>
          </span>
        ) : (
          <span className="text-gray-500">No next run scheduled</span>
        )}
        <span className="text-xs text-gray-400 shrink-0">
          window: {formatDurationS(snapshot.minIntervalS)} – {formatDurationS(snapshot.maxIntervalS)}
        </span>
      </div>
    </div>
  );
}

interface BarProps {
  remainingS: number | null;
  spanS: number;
  minS: number;
  maxS: number;
  running: boolean;
}

/**
 * Bar fills to "time remaining until next run", anchored LEFT, and shrinks
 * smoothly toward 0 each second. Hits 0 exactly when the run fires.
 *
 * A vertical tick marks the "min interval" position on the [0, max] scale —
 * useful for seeing how close the schedule is to the earliest-possible
 * fire-time vs the latest.
 */
function ProgressBar({ remainingS, spanS, minS, maxS, running }: BarProps) {
  let fillPct = remainingS != null ? (remainingS / spanS) * 100 : 0;
  fillPct = Math.max(0, Math.min(100, fillPct));
  // Min tick (where bar would be when remaining=minIntervalS, i.e. earliest possible fire).
  const minTickPct = (minS / Math.max(maxS, 1)) * 100;

  return (
    <div className="relative w-full h-3 rounded-full bg-gray-200 overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-linear ${
          running ? 'bg-amber-500 animate-pulse' : 'bg-blue-500'
        }`}
        style={{ width: `${fillPct}%` }}
      />
      <div
        className="absolute inset-y-0 w-px bg-gray-500/60"
        style={{ left: `${minTickPct}%` }}
        title={`min interval (${minS}s)`}
      />
    </div>
  );
}
