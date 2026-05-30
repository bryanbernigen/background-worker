import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { verifySessionToken, type SessionPayload } from '@/lib/auth';

export async function requireSession(): Promise<
  { ok: true; session: SessionPayload } | { ok: false; res: NextResponse }
> {
  const store = await cookies();
  const token = store.get('session')?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return { ok: false, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { ok: true, session };
}
