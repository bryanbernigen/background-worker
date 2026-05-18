import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

async function safeGet<T>(key: string): Promise<T | null> {
  try {
    return await kvGet<T>(key);
  } catch {
    return null;
  }
}

export async function GET() {
  const [lastChecked, nextAllowed, cookie, activity] = await Promise.all([
    safeGet<string>('last_checked'),
    safeGet<string>('next_allowed_run'),
    safeGet<string>('da_cookie'),
    safeGet<Array<{ timestamp: string; type: string; message: string }>>('activity_log'),
  ]);

  let status: 'running' | 'sleeping' | 'auth_error' | 'no_cookie' = 'sleeping';
  if (!cookie) status = 'no_cookie';

  return NextResponse.json({
    lastChecked,
    nextCheck: nextAllowed,
    status,
    activity: activity ?? [],
  });
}
