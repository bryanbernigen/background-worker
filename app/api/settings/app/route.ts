import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';

interface AppSettings {
  timezoneOffset: number;
  dayStartHour: number;
  dayEndHour: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  timezoneOffset: 7,
  dayStartHour: 7,
  dayEndHour: 23,
};

export async function GET() {
  const settings = await kvGet<AppSettings>('app_settings');
  return NextResponse.json(settings ?? DEFAULT_SETTINGS);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const settings: AppSettings = {
    timezoneOffset: parseInt(body.timezoneOffset ?? DEFAULT_SETTINGS.timezoneOffset, 10),
    dayStartHour: parseInt(body.dayStartHour ?? DEFAULT_SETTINGS.dayStartHour, 10),
    dayEndHour: parseInt(body.dayEndHour ?? DEFAULT_SETTINGS.dayEndHour, 10),
  };
  await kvSet('app_settings', settings);
  return NextResponse.json(settings);
}
