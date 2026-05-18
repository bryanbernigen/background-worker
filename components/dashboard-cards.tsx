'use client';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/card';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';

interface ActivityEntry {
  timestamp: string;
  type: 'check' | 'new_item' | 'notification' | 'error';
  message: string;
}

interface StatusData {
  lastChecked: string | null;
  nextCheck: string | null;
  status: 'running' | 'sleeping' | 'auth_error' | 'no_cookie';
  activity: ActivityEntry[];
}

export default function DashboardCards() {
  const [data, setData] = useState<StatusData | null>(null);
  const [running, setRunning] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      await fetch('/api/cron/check', { headers: { 'x-cron-secret': 'manual' } });
      await fetchStatus();
    } finally {
      setRunning(false);
    }
  };

  const statusColor = data?.status === 'running' ? 'green' :
    data?.status === 'auth_error' ? 'red' : 'gray';

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold mb-3">Status</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Last Checked</p>
            <p className="font-medium">{data?.lastChecked ?? 'Never'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Next Check</p>
            <p className="font-medium">{data?.nextCheck ?? 'Calculating...'}</p>
          </div>
          <div className="col-span-2">
            <p className="text-sm text-gray-500">Checker Status</p>
            <Badge color={statusColor}>{data?.status ?? 'unknown'}</Badge>
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={runNow} disabled={running} className="bg-blue-600 text-white hover:bg-blue-700">
            {running ? 'Running...' : 'Run Check Now'}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold mb-3">Recent Activity</h2>
        {!data?.activity?.length ? (
          <p className="text-gray-500 text-sm">No recent activity</p>
        ) : (
          <ul className="space-y-2">
            {data.activity.map((entry, i) => (
              <li key={i} className="text-sm border-b border-gray-100 pb-2">
                <span className="text-gray-400">[{new Date(entry.timestamp).toLocaleString()}]</span>{' '}
                {entry.message}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
