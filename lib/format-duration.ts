/** Format a duration in seconds as "1h 2m 3s" / "5m 30s" / "45s". */
export function formatDurationS(totalSeconds: number, opts: { showZero?: boolean } = {}): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s === 0) return opts.showZero ? '0s' : '0s';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (sec > 0 || parts.length === 0) parts.push(`${sec}s`);
  return parts.join(' ');
}

/** Format a duration in milliseconds. */
export function formatDurationMs(ms: number): string {
  return formatDurationS(ms / 1000);
}
