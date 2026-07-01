const PUBLIC = new Set(['/api/auth/login', '/api/auth/logout', '/api/contact']);
const SPECIAL = new Set(['/api/health', '/api/cron/check', '/api/cron/tick']); // gated elsewhere in middleware
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** True when middleware should require a valid admin token before allowing. */
export function requiresAdminToken(pathname: string, method: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  if (PUBLIC.has(pathname) || SPECIAL.has(pathname)) return false;
  return MUTATING.has(method);
}
