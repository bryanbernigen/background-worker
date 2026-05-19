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
  const [lastChecked, nextAllowed, cookie, activity, settings] = await Promise.all([
    safeGet<string>('last_checked'),
    safeGet<string>('next_allowed_run'),
    safeGet<string>('da_cookie'),
    safeGet<Array<{ timestamp: string; type: string; message: string }>>('activity_log'),
    safeGet<{ timezoneOffset: number; dayStartHour: number; dayEndHour: number }>('app_settings'),
  ]);

  let status: 'running' | 'sleeping' | 'auth_error' | 'no_cookie' = 'sleeping';
  if (!cookie) status = 'no_cookie';

  return NextResponse.json({
    lastChecked,
    nextCheck: nextAllowed,
    status,
    activity: activity ?? [],
    settings: settings ?? { timezoneOffset: 7, dayStartHour: 7, dayEndHour: 23 },
  });
}
