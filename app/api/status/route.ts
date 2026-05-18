import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export async function GET() {
  const lastChecked = await kvGet<string>('last_checked');
  const nextAllowed = await kvGet<string>('next_allowed_run');
  const cookie = await kvGet<string>('da_cookie');
  const activity = await kvGet<Array<{ timestamp: string; type: string; message: string }>>('activity_log');

  let status: 'running' | 'sleeping' | 'auth_error' | 'no_cookie' = 'sleeping';
  if (!cookie) status = 'no_cookie';

  return NextResponse.json({
    lastChecked,
    nextCheck: nextAllowed,
    status,
    activity: activity ?? [],
  });
}
