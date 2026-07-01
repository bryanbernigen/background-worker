export function statusColorVar(status: string): string {
  switch (status) {
    case 'ok':      return 'var(--color-ok)';
    case 'error':   return 'var(--color-error)';
    case 'skipped': return 'var(--color-warn)';
    default:        return 'var(--color-off)';
  }
}
