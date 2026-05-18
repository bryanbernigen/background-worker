import { NextRequest, NextResponse } from 'next/server';
import { kvSet } from '@/lib/kv';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { waRecipient } = body;
  if (waRecipient) {
    await kvSet('wa_recipient', waRecipient);
  }
  return NextResponse.json({ success: true });
}
