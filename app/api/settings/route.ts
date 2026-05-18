import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export async function GET() {
  const cookie = await kvGet<string>('da_cookie');
  const waRecipient = await kvGet<string>('wa_recipient');
  // Return masked cookie (show only first/last 10 chars if present)
  const maskedCookie = cookie
    ? cookie.substring(0, 10) + '...' + cookie.substring(cookie.length - 10)
    : '';
  return NextResponse.json({ cookie: maskedCookie, waRecipient: waRecipient ?? '' });
}
