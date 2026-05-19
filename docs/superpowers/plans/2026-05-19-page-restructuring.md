# Page Restructuring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the app into Dashboard Home (checker list), Checker Pages (data-annotation), and Global Settings.

**Architecture:** Dashboard home at `/dashboard` shows a grid of checker cards. Each checker gets its own page under `/dashboard/<slug>`. Global settings live at `/dashboard/settings`. App settings (timezone, time window) are stored in Redis under `app_settings` key.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS v4, Upstash Redis.

---

### Task 1: App Settings API (timezone and time window in Redis)

**Files:**
- Create: `app/api/settings/app/route.ts`
- Modify: `lib/kv.ts` (add `kvGet`/`kvSet` already exist, use as-is)

- [ ] **Step 1: Create app settings API**

Create `app/api/settings/app/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';

interface AppSettings {
  timezoneOffset: number;
  dayStartHour: number;
  dayEndHour: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  timezoneOffset: 7,
  dayStartHour: 7,
  dayEndHour: 23,
};

export async function GET() {
  const settings = await kvGet<AppSettings>('app_settings');
  return NextResponse.json(settings ?? DEFAULT_SETTINGS);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const settings: AppSettings = {
    timezoneOffset: parseInt(body.timezoneOffset ?? DEFAULT_SETTINGS.timezoneOffset, 10),
    dayStartHour: parseInt(body.dayStartHour ?? DEFAULT_SETTINGS.dayStartHour, 10),
    dayEndHour: parseInt(body.dayEndHour ?? DEFAULT_SETTINGS.dayEndHour, 10),
  };
  await kvSet('app_settings', settings);
  return NextResponse.json(settings);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/settings/app/route.ts
git commit -m "feat: add app settings API for timezone and time window"
```

---

### Task 2: Dashboard Home (checker grid page)

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Replace dashboard page with checker grid**

Replace `app/dashboard/page.tsx` content with:

```typescript
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/card';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';

const CHECKERS = [
  {
    slug: 'data-annotation',
    name: 'Data Annotation',
    description: 'Monitor paid projects and qualifications',
    emoji: '📋',
  },
];

function CheckerCard({ checker }: { checker: typeof CHECKERS[0] }) {
  const [status, setStatus] = useState<string>('unknown');

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => setStatus(d.status ?? 'unknown'))
      .catch(() => setStatus('unknown'));
  }, []);

  const statusColor = status === 'running' ? 'green'
    : status === 'auth_error' ? 'red'
    : status === 'no_cookie' ? 'orange'
    : 'gray';

  return (
    <Card>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{checker.emoji}</span>
          <h2 className="text-lg font-semibold">{checker.name}</h2>
        </div>
        <Badge color={statusColor}>{status}</Badge>
      </div>
      <p className="text-sm text-gray-500 mb-4">{checker.description}</p>
      <Link href={`/dashboard/${checker.slug}`}>
        <Button className="bg-blue-600 text-white hover:bg-blue-700">Open</Button>
      </Link>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Auto Checker</h1>
          <div className="flex gap-4">
            <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-gray-700">Settings</Link>
            <form action="/api/auth/logout" method="POST">
              <button className="text-sm text-gray-500 hover:text-gray-700">Logout</button>
            </form>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {CHECKERS.map(checker => (
            <CheckerCard key={checker.slug} checker={checker} />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: replace dashboard with checker grid"
```

---

### Task 3: Data Annotation Checker Page

**Files:**
- Create: `app/dashboard/data-annotation/page.tsx`
- Create: `components/da-checker-page.tsx` (checker-specific page component)
- Modify: `app/api/status/route.ts` — remove timezone fields (not needed here)

- [ ] **Step 1: Create DA Checker Page component**

Create `components/da-checker-page.tsx` (move current dashboard-cards + settings-form content):

```typescript
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

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

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
```

- [ ] **Step 2: Create the DA checker page**

Create `app/dashboard/data-annotation/page.tsx`:

```typescript
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from '@/lib/auth';
import DaCheckerPage from '@/components/da-checker-page';

export default async function DataAnnotationPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect('/');

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">← Dashboard</a>
        </div>
        <h1 className="text-2xl font-bold mb-6">Data Annotation</h1>
        <DaCheckerPage />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/da-checker-page.tsx app/dashboard/data-annotation/page.tsx
git commit -m "feat: add Data Annotation checker page"
```

---

### Task 4: Global Settings Page

**Files:**
- Create: `app/dashboard/settings/page.tsx`
- Create: `components/global-settings-form.tsx`
- Modify: `app/api/settings/route.ts` — no changes needed, already returns cookie/waRecipient

- [ ] **Step 1: Create Global Settings Form**

Create `components/global-settings-form.tsx`:

```typescript
'use client';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/card';
import Button from '@/components/ui/button';

interface AppSettings {
  timezoneOffset: number;
  dayStartHour: number;
  dayEndHour: number;
}

export default function GlobalSettingsForm() {
  const [settings, setSettings] = useState<AppSettings>({ timezoneOffset: 7, dayStartHour: 7, dayEndHour: 23 });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings/app')
      .then(r => r.json())
      .then(d => setSettings(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    const res = await fetch('/api/settings/app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold mb-4">Time Window</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone Offset (hours from UTC)</label>
            <input
              type="number"
              value={settings.timezoneOffset}
              onChange={e => setSettings(s => ({ ...s, timezoneOffset: parseInt(e.target.value, 10) }))}
              className="w-32 px-3 py-2 border border-gray-300 rounded-md"
              min={-12} max={14}
            />
            <p className="text-xs text-gray-500 mt-1">WIB=7, WITA=8, WIT=9, UTC=0</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Hour (e.g. 7 = 7AM)</label>
              <input
                type="number"
                value={settings.dayStartHour}
                onChange={e => setSettings(s => ({ ...s, dayStartHour: parseInt(e.target.value, 10) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                min={0} max={23}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Hour (e.g. 23 = 11PM)</label>
              <input
                type="number"
                value={settings.dayEndHour}
                onChange={e => setSettings(s => ({ ...s, dayEndHour: parseInt(e.target.value, 10) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                min={0} max={23}
              />
            </div>
          </div>
          <div>
            <Button onClick={save} className="bg-blue-600 text-white hover:bg-blue-700">
              {saved ? 'Saved!' : 'Save Settings'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create the settings page**

Create `app/dashboard/settings/page.tsx`:

```typescript
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from '@/lib/auth';
import GlobalSettingsForm from '@/components/global-settings-form';

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect('/');

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">← Dashboard</a>
        </div>
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        <GlobalSettingsForm />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/global-settings-form.tsx app/dashboard/settings/page.tsx
git commit -m "feat: add global settings page with timezone config"
```

---

### Task 5: Wire cron to use app settings from Redis

**Files:**
- Modify: `app/api/cron/check/route.ts`
- Modify: `app/api/status/route.ts`

- [ ] **Step 1: Update cron to read settings from Redis**

Replace `app/api/cron/check/route.ts` with:

```typescript
// app/api/cron/check/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { checkers } from '@/lib/checkers';
import { kvGet, kvSet } from '@/lib/kv';

interface AppSettings {
  timezoneOffset: number;
  dayStartHour: number;
  dayEndHour: number;
}

async function getAppSettings(): Promise<AppSettings> {
  const settings = await kvGet<AppSettings>('app_settings');
  return settings ?? { timezoneOffset: 7, dayStartHour: 7, dayEndHour: 23 };
}

function isWithinTimeWindow(settings: AppSettings): boolean {
  const now = new Date();
  const local = new Date(now.getTime() + settings.timezoneOffset * 60 * 60 * 1000);
  const hour = local.getUTCHours();
  return hour >= settings.dayStartHour && hour <= settings.dayEndHour;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function GET(req: NextRequest) {
  const isManual = req.headers.get('x-cron-secret') === 'manual';
  const settings = await getAppSettings();

  if (!isManual && !isWithinTimeWindow(settings)) {
    return NextResponse.json({ message: 'Outside time window' });
  }

  const nextAllowed = await kvGet<string>('next_allowed_run');
  if (!isManual && nextAllowed) {
    if (new Date() < new Date(nextAllowed)) {
      return NextResponse.json({ message: `Too early. Next run: ${nextAllowed}` });
    }
  }

  const lockKey = 'cron_lock';
  const lockVal = `locked_${Date.now()}`;
  if (!isManual) {
    const existing = await kvGet<string>(lockKey);
    if (existing) return NextResponse.json({ message: 'Another run in progress' });
    await kvSet(lockKey, lockVal, 300);
  }

  try {
    const nextMinutes = randomBetween(10, 30);
    const nextRun = new Date(Date.now() + nextMinutes * 60 * 1000);
    await kvSet('next_allowed_run', nextRun.toISOString());
    await kvSet('last_checked', new Date().toISOString());

    const results = [];
    for (const checker of checkers) {
      try {
        const result = await checker.run();
        results.push(result);
      } catch (err) {
        results.push({ checkerName: checker.name, newItems: [], errors: [String(err)] });
      }
    }

    return NextResponse.json({ message: 'Check completed', nextRun: nextRun.toISOString(), results });
  } finally {
    if (!isManual) await kvSet(lockKey, '', 1);
  }
}
```

- [ ] **Step 2: Update status API to include timezone info**

Replace `app/api/status/route.ts` with:

```typescript
import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

async function safeGet<T>(key: string): Promise<T | null> {
  try { return await kvGet<T>(key); } catch { return null; }
}

export async function GET() {
  const [lastChecked, nextAllowed, cookie, activity, settings] = await Promise.all([
    safeGet<string>('last_checked'),
    safeGet<string>('next_allowed_run'),
    safeGet<string>('da_cookie'),
    safeGet<Array<{ timestamp: string; type: string; message: string }>>('activity_log'),
    safeGet<{ timezoneOffset: number; dayStartHour: number; dayEndHour: number }>('app_settings'),
  ]);

  let status: 'running' | 'sleeping' | 'auth_error' | 'no_cookie' = 'sleeping';
  if (!cookie) status = 'no_cookie';

  return NextResponse.json({
    lastChecked,
    nextCheck: nextAllowed,
    status,
    activity: activity ?? [],
    settings: settings ?? { timezoneOffset: 7, dayStartHour: 7, dayEndHour: 23 },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/check/route.ts app/api/status/route.ts
git commit -m "fix: cron and status use app settings from Redis"
```

---

### Task 6: Remove old settings page, clean up

**Files:**
- Delete: `app/settings/page.tsx` (old settings page at root level)

- [ ] **Step 1: Remove old settings page**

Delete `app/settings/page.tsx`.

- [ ] **Step 2: Commit**

```bash
git rm app/settings/page.tsx
git commit -m "chore: remove old settings page at root level"
```
