import { NextRequest, NextResponse } from 'next/server';
import { kvSet } from '@/lib/kv';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { cookie } = body;
  if (cookie) {
    await kvSet('da_cookie', cookie);
  }
  return NextResponse.json({ success: true });
}
