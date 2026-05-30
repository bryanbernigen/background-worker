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
  settings: {
    timezoneOffset: number;
    dayStartHour: number;
    dayEndHour: number;
  };
  checkHistory: CheckRun[];
}

interface CheckRun {
  timestamp: string;
  checkerName: string;
  projectsFound: number;
  qualificationsFound: number;
  paidProjectsFound: number;
  paidQualsFound: number;
  newProjects: number;
  newQualifications: number;
  paidProjectsNew: number;
  paidQualsNew: number;
  errors: string[];
  reason?: string;
  triggerType: 'manual' | 'scheduled';
  diffMs: number;
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
  const [historyPage, setHistoryPage] = useState(0);
  const PAGE_SIZE = 20;

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
    setHistoryPage(0);
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchSettings, fetchStatus]);

  const runNow = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/cron/check'); 
      
      const body = await res.json();
      setResult({ ok: res.ok, msg: body.message ?? 'Check triggered' });
      
      // Fetch fresh status immediately to update timer
      const statusRes = await fetch('/api/status');
      if (statusRes.ok) setData(await statusRes.json());
      setHistoryPage(0);
    } catch {
      setResult({ ok: false, msg: 'Network error' });
    } finally { 
      setRunning(false); 
    }
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
        {data?.settings && (
          <div className="mb-4 text-sm text-gray-500">
            Active window: {data.settings.dayStartHour}:00 – {data.settings.dayEndHour}:00
            (UTC{data.settings.timezoneOffset >= 0 ? '+' : ''}{data.settings.timezoneOffset})
            <span className="ml-2 text-xs">
              <a href="/dashboard/settings" className="text-blue-600 hover:underline">Change</a>
            </span>
          </div>
        )}
        <div className="flex items-center gap-3 mb-3">
          <Button onClick={runNow} disabled={running} className="bg-blue-600 text-white hover:bg-blue-700">
            {running ? 'Running...' : 'Run Check Now'}
          </Button>
          {result && (
            <span className={`text-sm font-medium ${result.ok ? 'text-green-600' : 'text-red-600'}`}>{result.msg}</span>
          )}
        </div>
        <p className="text-xs text-gray-400 font-mono">Scrapes: https://app.dataannotation.tech/workers/projects</p>
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

      {/* Check History Card */}
      <Card>
        <h2 className="text-lg font-semibold mb-3">Check History</h2>
        {!data?.checkHistory?.length ? (
          <p className="text-gray-500 text-sm">No checks recorded yet</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2 pr-4">Time</th>
                    <th className="pb-2 pr-4">Projects</th>
                    <th className="pb-2 pr-4">Quals</th>
                    <th className="pb-2 pr-4">New Proj</th>
                    <th className="pb-2 pr-4">New Qual</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {data.checkHistory
                    .slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE)
                    .map((run, i) => {
                      const statusLabel = run.reason
                        ? run.reason.replace(/_/g, ' ')
                        : run.errors.length > 0 ? 'fail' : 'success';
                      const statusClass = run.reason ? 'text-yellow-600' : run.errors.length > 0 ? 'text-red-500' : 'text-green-600';
                      const diffMins = Math.round(run.diffMs / 60000);
                      const diffLabel = diffMins < 1 ? '<1m' : diffMins >= 60 ? `${Math.round(diffMins / 60)}h` : `${diffMins}m`;
                      return (
                        <tr key={i} className="border-b border-gray-100 last:border-0">
                          <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">{new Date(run.timestamp).toLocaleString()}</td>
                          <td className="py-2 pr-4">
                            {run.paidProjectsFound}/{run.projectsFound}
                          </td>
                          <td className="py-2 pr-4">
                            {run.paidQualsFound}/{run.qualificationsFound}
                          </td>
                          <td className="py-2 pr-4">
                            {run.paidProjectsNew > 0 ? (
                              <span className="text-green-600">+{run.paidProjectsNew}/{run.newProjects}</span>
                            ) : (
                              <span className="text-gray-400">0/{run.newProjects}</span>
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            {run.paidQualsNew > 0 ? (
                              <span className="text-green-600">+{run.paidQualsNew}/{run.newQualifications}</span>
                            ) : (
                              <span className="text-gray-400">0/{run.newQualifications}</span>
                            )}
                          </td>
                          <td className={`py-2 pr-4 ${statusClass}`}>{statusLabel}</td>
                          <td className="py-2 pr-4 text-gray-400">{run.triggerType}</td>
                          <td className="py-2 text-gray-400">{diffLabel}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {data.checkHistory.length > PAGE_SIZE && (
              <div className="flex justify-between items-center mt-3">
                <button
                  onClick={() => setHistoryPage(p => Math.max(0, p - 1))}
                  disabled={historyPage === 0}
                  className="text-xs text-blue-600 disabled:text-gray-400 disabled:cursor-not-allowed hover:underline"
                >
                  ← Newer
                </button>
                <span className="text-xs text-gray-400">
                  {historyPage * PAGE_SIZE + 1}–{Math.min((historyPage + 1) * PAGE_SIZE, data.checkHistory.length)} of {data.checkHistory.length}
                </span>
                <button
                  onClick={() => setHistoryPage(p => (p + 1) * PAGE_SIZE < data.checkHistory.length ? p + 1 : p)}
                  disabled={(historyPage + 1) * PAGE_SIZE >= data.checkHistory.length}
                  className="text-xs text-blue-600 disabled:text-gray-400 disabled:cursor-not-allowed hover:underline"
                >
                  Older →
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
