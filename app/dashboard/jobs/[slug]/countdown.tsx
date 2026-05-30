'use client';
import { useEffect, useState } from 'react';

export default function Countdown({ nextRunAt }: { nextRunAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!nextRunAt) return <div className="text-sm text-gray-500">No next run scheduled</div>;
  const remainMs = new Date(nextRunAt).getTime() - now;
  if (remainMs <= 0) return <div className="text-sm text-gray-500">Running soon…</div>;
  const s = Math.floor(remainMs / 1000);
  const mm = Math.floor(s / 60), ss = s % 60;
  return <div className="text-sm text-gray-600">Next run in {mm}m {ss}s</div>;
}
