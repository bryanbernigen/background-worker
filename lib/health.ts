// Pure health aggregation — no DB/network here so it stays unit-testable.
// The route gathers the raw inputs and hands them to computeHealth().

export type HealthStatus = 'ok' | 'degraded' | 'down';

/** A run is "stale" if no success within this many max-intervals while inside the window. */
export const STALE_INTERVAL_FACTOR = 3;

export interface JobHealthInput {
  slug: string;
  enabled: boolean;
  withinWindow: boolean;
  lastSuccessAt: number | null; // epoch ms of last 'ok' run, or null
  maxIntervalS: number;
  cookieExpiresAt: number | null; // epoch ms, or null if unknown/not applicable
  cookieInvalid: boolean;
}

export interface HealthInput {
  now: number;
  database: { ok: boolean };
  scheduler: { started: boolean; armedTimers: number };
  waha: { configured: boolean; reachable: boolean; status: string | null; account: string | null };
  jobs: JobHealthInput[];
}

export interface JobHealthReport {
  slug: string;
  ok: boolean;
  enabled: boolean;
  withinWindow: boolean;
  lastSuccessAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  cookieExpiresAt: string | null;
  cookieValid: boolean;
}

export interface HealthReport {
  status: HealthStatus;
  checks: {
    database: { ok: boolean };
    scheduler: { ok: boolean; armedTimers: number };
    waha: { ok: boolean; status: string | null; account: string | null };
    jobs: JobHealthReport[];
  };
}

function evalJob(j: JobHealthInput, now: number): JobHealthReport {
  const ageSeconds = j.lastSuccessAt != null ? Math.floor((now - j.lastSuccessAt) / 1000) : null;
  // Only judge staleness while monitoring is supposed to be happening.
  const stale = j.enabled && j.withinWindow &&
    (ageSeconds == null || ageSeconds > j.maxIntervalS * STALE_INTERVAL_FACTOR);
  const cookieValid = !j.cookieInvalid && (j.cookieExpiresAt == null || j.cookieExpiresAt > now);
  return {
    slug: j.slug,
    ok: !stale && cookieValid,
    enabled: j.enabled,
    withinWindow: j.withinWindow,
    lastSuccessAt: j.lastSuccessAt != null ? new Date(j.lastSuccessAt).toISOString() : null,
    ageSeconds,
    stale,
    cookieExpiresAt: j.cookieExpiresAt != null ? new Date(j.cookieExpiresAt).toISOString() : null,
    cookieValid,
  };
}

export function computeHealth(input: HealthInput): HealthReport {
  const dbOk = input.database.ok;
  const schedOk = input.scheduler.started;
  const wahaOk = input.waha.configured && input.waha.reachable && input.waha.status === 'WORKING';
  const jobs = input.jobs.map(j => evalJob(j, input.now));
  const anyJobBad = jobs.some(j => !j.ok);

  let status: HealthStatus = 'ok';
  if (!dbOk || !schedOk) status = 'down';              // core process broken
  else if (!wahaOk || anyJobBad) status = 'degraded';  // can't deliver / not monitoring

  return {
    status,
    checks: {
      database:  { ok: dbOk },
      scheduler: { ok: schedOk, armedTimers: input.scheduler.armedTimers },
      waha:      { ok: wahaOk, status: input.waha.status, account: input.waha.account },
      jobs,
    },
  };
}

/** Map an overall status to an HTTP code uptime monitors can alert on. */
export function healthHttpStatus(s: HealthStatus): number {
  return s === 'ok' ? 200 : 503;
}
