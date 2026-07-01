import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { verifySessionToken, type SessionPayload } from '@/lib/auth';
import { isGuestModeEnabled } from './settings';

export type Role = 'admin' | 'guest';

/** Pure role decision. A valid token means admin (only admins get tokens);
 *  otherwise guest when guest-mode is on, else no access. */
export function roleFromToken(session: SessionPayload | null, guestModeEnabled: boolean): Role | null {
  if (session) return session.role;
  return guestModeEnabled ? 'guest' : null;
}

export async function resolveRole(): Promise<Role | null> {
  const store = await cookies();
  const token = store.get('session')?.value;
  const session = token ? await verifySessionToken(token) : null;
  return roleFromToken(session, await isGuestModeEnabled());
}

export async function requireAdmin(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const role = await resolveRole();
  if (role === 'admin') return { ok: true };
  return { ok: false, res: NextResponse.json({ error: role ? 'forbidden' : 'unauthorized' }, { status: role ? 403 : 401 }) };
}

export async function requireViewer(): Promise<{ ok: true; role: Role } | { ok: false; res: NextResponse }> {
  const role = await resolveRole();
  if (!role) return { ok: false, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  return { ok: true, role };
}
