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
  const [lastChecked, nextAllowed, cookie, activity, settings, checkHistory] = await Promise.all([
    safeGet<string>('last_checked'),
    safeGet<string>('next_allowed_run'),
    safeGet<string>('da_cookie'),
    safeGet<Array<{ timestamp: string; type: string; message: string }>>('activity_log'),
    safeGet<{ timezoneOffset: number; dayStartHour: number; dayEndHour: number }>('app_settings'),
    safeGet<Array<{ timestamp: string; checkerName: string; projectsFound: number; qualificationsFound: number; paidProjectsFound: number; paidQualsFound: number; newProjects: number; newQualifications: number; paidProjectsNew: number; paidQualsNew: number; errors: string[]; reason?: string; triggerType: 'manual' | 'scheduled'; diffMs: number; debug?: { htmlLen: number; reportableProjectsInfo: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[]; merchProjects: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[]; merchQuals: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[]; extracted: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[] } }>>('check_history'),
  ]);

  let status: 'running' | 'sleeping' | 'auth_error' | 'no_cookie' = 'sleeping';
  if (!cookie) status = 'no_cookie';

  return NextResponse.json({
    lastChecked,
    nextCheck: nextAllowed,
    status,
    activity: activity ?? [],
    settings: settings ?? { timezoneOffset: 7, dayStartHour: 7, dayEndHour: 23 },
    checkHistory: checkHistory ?? [],
  });
}
