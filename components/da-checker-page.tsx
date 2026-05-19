'use client';
import { useEffect, useState, useCallback } from 'react';
import Card from '@/components/ui/card';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';

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

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function CountdownTimer({ nextCheck }: { nextCheck: string | null }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!nextCheck) { setRemaining(null); return; }
    const update = () => {
      const diff = new Date(nextCheck).getTime() - Date.now();
      setRemaining(Math.max(0, diff));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [nextCheck]);

  if (nextCheck === null || remaining === null) {
    return <p className="text-sm text-gray-500">Calculating next check...</p>;
  }

  const MAX_MS = 30 * 60 * 1000;
  const pct = Math.min(100, (remaining / MAX_MS) * 100);
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const label = remaining <= 0 ? 'Ready to check' : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} remaining`;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-gray-400">{new Date(nextCheck).toLocaleTimeString()}</p>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div className="bg-blue-500 h-2 rounded-full transition-all duration-1000" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function DaCheckerPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [cookie, setCookie] = useState('');
  const [waRecipient, setWaRecipient] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState('');
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const [statusRes, settingsRes] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
      ]);
      setData(statusRes);
      setCookie(settingsRes.cookie ?? '');
      setWaRecipient(settingsRes.waRecipient ?? '');
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSettings();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchSettings, fetchStatus]);

  const runNow = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/cron/check', { headers: { 'x-cron-secret': 'manual' } });
      const body = await res.json();
      setResult({ ok: res.ok, msg: body.message ?? 'Check triggered' });
      await fetchStatus();
    } catch {
      setResult({ ok: false, msg: 'Network error' });
    } finally { setRunning(false); }
  };

  const saveCookie = async () => {
    await fetch('/api/settings/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie }),
    });
    setSaved('cookie');
    setTimeout(() => setSaved(''), 2000);
  };

  const saveWaRecipient = async () => {
    await fetch('/api/settings/wa-recipient', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waRecipient }),
    });
    setSaved('wa');
    setTimeout(() => setSaved(''), 2000);
  };

  const sendTest = async () => {
    setTestResult(null);
    const res = await fetch('/api/settings/test-whatsapp', { method: 'POST' });
    const body = await res.json();
    setTestResult(body.success
      ? { type: 'success', msg: 'Test message sent!' }
      : { type: 'error', msg: body.error ?? 'Failed to send' }
    );
  };

  if (loading) return <p className="text-gray-500">Loading...</p>;

  const statusColor = data?.status === 'running' ? 'green'
    : data?.status === 'auth_error' ? 'red'
    : data?.status === 'no_cookie' ? 'orange' : 'gray';

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card>
        <h2 className="text-lg font-semibold mb-3">Status</h2>
        <div className="mb-4"><CountdownTimer nextCheck={data?.nextCheck ?? null} /></div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-sm text-gray-500">Last Checked</p>
            <p className="font-medium">{formatRelative(data?.lastChecked ?? null)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Status</p>
            <Badge color={statusColor}>{data?.status ?? 'unknown'}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={runNow} disabled={running} className="bg-blue-600 text-white hover:bg-blue-700">
            {running ? 'Running...' : 'Run Check Now'}
          </Button>
          {result && (
            <span className={`text-sm font-medium ${result.ok ? 'text-green-600' : 'text-red-600'}`}>{result.msg}</span>
          )}
        </div>
      </Card>

      {/* Cookie Card */}
      <Card>
        <h2 className="text-lg font-semibold mb-3">Cookie</h2>
        <p className="text-sm text-gray-500 mb-3">Paste your DataAnnotation session cookie from browser dev tools.</p>
        <textarea
          value={cookie}
          onChange={e => setCookie(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
          placeholder="cookieyes-consent=...; conv_session=..."
        />
        <div className="mt-3">
          <Button onClick={saveCookie} className="bg-blue-600 text-white hover:bg-blue-700">
            {saved === 'cookie' ? 'Saved!' : 'Save Cookie'}
          </Button>
        </div>
      </Card>

      {/* WhatsApp Card */}
      <Card>
        <h2 className="text-lg font-semibold mb-3">WhatsApp</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recipient (country code, no +)</label>
            <Input value={waRecipient} onChange={e => setWaRecipient(e.target.value)} placeholder="6281234567890" />
          </div>
          <div className="flex gap-3">
            <Button onClick={saveWaRecipient} className="bg-blue-600 text-white hover:bg-blue-700">
              {saved === 'wa' ? 'Saved!' : 'Save Recipient'}
            </Button>
            <Button onClick={sendTest} className="bg-green-600 text-white hover:bg-green-700">Send Test</Button>
          </div>
          {testResult && (
            <p className={`text-sm ${testResult.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{testResult.msg}</p>
          )}
        </div>
      </Card>

      {/* Activity Card */}
      <Card>
        <h2 className="text-lg font-semibold mb-3">Recent Activity</h2>
        {!data?.activity?.length ? (
          <p className="text-gray-500 text-sm">No recent activity</p>
        ) : (
          <ul className="space-y-2">
            {data.activity.map((entry, i) => (
              <li key={i} className="text-sm border-b border-gray-100 pb-2">
                <span className="text-gray-400">[{new Date(entry.timestamp).toLocaleString()}]</span>{' '}{entry.message}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
