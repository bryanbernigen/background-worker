import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createSessionToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminHash = process.env.ADMIN_PASSWORD_HASH;

  if (!adminHash) {
    return NextResponse.json({ error: 'Server misconfigured: ADMIN_PASSWORD_HASH missing' }, { status: 500 });
  }
  if (username !== adminUser || !(await bcrypt.compare(password, adminHash))) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await createSessionToken(username);
  const origin = req.headers.get('origin') ?? new URL(req.url).origin;
  const res = NextResponse.redirect(new URL('/dashboard', origin));
  res.cookies.set('session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  return res;
}
