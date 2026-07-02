'use client';
import { useEffect, useState } from 'react';
import { formatDurationS } from '@/lib/format-duration';

interface Props { jobId: number; current: unknown }

interface CookieState {
  preview?: string;
  expiresAt?: number;
  checkedAt?: number;
  invalid?: boolean;
}

function readState(current: unknown): CookieState {
  const c = (current ?? {}) as Record<string, unknown>;
  return {
    preview:   typeof c.cookie_preview    === 'string'  ? c.cookie_preview    : undefined,
    expiresAt: typeof c.cookie_expires_at === 'number'  ? c.cookie_expires_at : undefined,
    checkedAt: typeof c.cookie_checked_at === 'number'  ? c.cookie_checked_at : undefined,
    invalid:   c.cookie_invalid === true,
  };
}

export default function DASettingsPanel({ current }: Props) {
  const [state, setState] = useState<CookieState>(() => readState(current));
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState<string | null>(null);

  // Pull the latest cookie state from the server.
  const refresh = async () => {
    try {
      const res = await fetch(`/api/jobs/data-annotation`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setState(readState(body?.job?.custom));
    } catch { /* swallow */ }
  };

  useEffect(() => { setState(readState(current)); }, [current]);

  // Poll so the expiry/countdown reflect background runs without a reload.
  useEffect(() => {
    const t = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(t);
  }, []);

  const save = async () => {
    if (!value) return;
    setBusy(true); setMsg('Saving & validating…');
    const res = await fetch(`/api/jobs/data-annotation/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ custom: { cookie: value } }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg('Cookie updated');
      setValue('');
      await refresh();
    } else if (res.status === 401) {
      setMsg('Session expired — redirecting to login…');
      setTimeout(() => { window.location.href = '/'; }, 1200);
    } else {
      setMsg(`Couldn't update cookie: ${await readError(res)}`);
    }
  };

  const { preview, expiresAt, checkedAt, invalid } = state;

  return (
    <div className="space-y-3 border border-border rounded p-4 bg-surface">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">DataAnnotation cookie</h3>
        {preview && <span className="text-xs px-2 py-0.5 rounded bg-ok/20 text-ok">stored</span>}
      </div>

      {preview ? (
        <StoredCookieView preview={preview} />
      ) : (
        <div className="text-sm text-warn bg-warn/10 border border-warn/30 rounded p-2">
          No cookie configured yet. Paste your session cookie below to enable scraping.
        </div>
      )}

      {preview && <CookieExpiry expiresAt={expiresAt} checkedAt={checkedAt} invalid={invalid} />}

      <label className="block">
        <span className="text-sm text-muted">{preview ? 'Replace with new cookie' : 'Paste session cookie'}</span>
        <textarea
          className="w-full bg-surface-2 border border-border rounded p-2 text-sm font-mono mt-1"
          rows={3}
          placeholder="session=...; other=..."
          value={value}
          onChange={e => setValue(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          disabled={busy || !value}
          onClick={save}
          className="px-3 py-1.5 rounded bg-accent text-bg font-medium disabled:opacity-50"
        >{preview ? 'Update cookie' : 'Save cookie'}</button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </div>
  );
}

/**
 * Shows the real session expiry (read from the scraped page) plus a live
 * countdown. The countdown ticks every second; the underlying expiry is
 * refreshed by the panel's poll. Goes amber under 24h, red once expired.
 */
function CookieExpiry({ expiresAt, checkedAt, invalid }: { expiresAt?: number; checkedAt?: number; invalid?: boolean }) {
  // Starts null so server and first client render match (no hydration mismatch).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (invalid) {
    return (
      <div className="text-sm rounded p-2 bg-error/10 border border-error/30 text-error">
        ⛔ Cookie was rejected by DataAnnotation — paste a fresh one.
      </div>
    );
  }

  if (!expiresAt) {
    return (
      <div className="text-sm rounded p-2 bg-surface-2 border border-border text-muted">
        No expiry detected yet — will populate on the next check.
      </div>
    );
  }

  const remainingS = now !== null ? (expiresAt - now) / 1000 : null;
  const expired = remainingS !== null && remainingS <= 0;
  const under24h = remainingS !== null && remainingS > 0 && remainingS <= 24 * 3600;

  const tone = expired
    ? 'bg-error/10 border-error/30 text-error'
    : under24h
      ? 'bg-warn/10 border-warn/30 text-warn'
      : 'bg-ok/10 border-ok/30 text-ok';

  return (
    <div className={`text-sm rounded p-2 border ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span>
          {remainingS === null ? (
            'Calculating…'
          ) : expired ? (
            <>⛔ Cookie <strong>expired</strong> {formatDurationS(-remainingS)} ago</>
          ) : (
            <>🔑 Cookie expires in <strong>{formatDurationS(remainingS)}</strong></>
          )}
        </span>
        <span className="text-xs opacity-80">{formatExpiryClock(expiresAt)}</span>
      </div>
      {checkedAt && (
        <div className="text-xs opacity-70 mt-0.5">
          checked {now !== null ? `${formatDurationS((now - checkedAt) / 1000)} ago` : '—'}
        </div>
      )}
    </div>
  );
}

/** Turn an error response into a human-readable message. */
async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string') return body.error;
    // Zod issues come back as an array — name the offending fields.
    if (Array.isArray(body?.error)) {
      const fields = body.error.map((i: { path?: (string | number)[] }) => i.path?.join('.')).filter(Boolean);
      return fields.length ? `invalid fields: ${[...new Set(fields)].join(', ')}` : `request rejected (HTTP ${res.status})`;
    }
  } catch { /* non-JSON body */ }
  return `HTTP ${res.status}`;
}

/** Absolute expiry in the viewer's local time, e.g. "Jun 25, 12:50 PM". */
function formatExpiryClock(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** Splits the preview string like "abcd…wxyz (50 chars)" into front + back parts for prominent display. */
function StoredCookieView({ preview }: { preview: string }) {
  // The server-formatted preview is `${front4}…${back4} (${N} chars)`.
  const m = preview.match(/^(.+?)…(.+?) \((\d+) chars\)$/);
  if (!m) {
    // Fallback if format changes.
    return <div className="font-mono text-sm bg-surface-2 border border-border rounded p-2 break-all">{preview}</div>;
  }
  const [, front, back, lenStr] = m;
  const totalLen = parseInt(lenStr, 10);
  const maskLen = Math.max(8, totalLen - front.length - back.length);
  const mask = '•'.repeat(Math.min(32, maskLen)); // cap visual mask length
  return (
    <div className="font-mono text-sm bg-surface-2 border border-border rounded p-2 break-all">
      <span className="text-text">{front}</span>
      <span className="text-muted" title={`${maskLen} hidden chars`}>{mask}</span>
      <span className="text-text">{back}</span>
      <span className="text-xs text-muted ml-2">({totalLen} chars total)</span>
    </div>
  );
}
