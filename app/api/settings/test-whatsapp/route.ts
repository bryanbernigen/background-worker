import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';
import { WahaClient } from '@/lib/waha';


export async function POST() {
  const waRecipient = await kvGet<string>('wa_recipient');
  if (!waRecipient) {
    return NextResponse.json({ success: false, error: 'No WhatsApp recipient configured' }, { status: 400 });
  }

  const wahaUrl = process.env.WAHA_URL;
  const wahaKey = process.env.WAHA_API_KEY ?? '';
  if (!wahaUrl) {
    return NextResponse.json({ success: false, error: 'WAHA_URL not configured' }, { status: 500 });
  }

  const waha = new WahaClient(wahaUrl, wahaKey);
  const success = await waha.sendText(waRecipient, '🎉 *Auto Checker*\n\nWhatsApp integration is working!\n\n---\nSent via Auto Checker');

  if (success) {
    return NextResponse.json({ success: true });
  } else {
    return NextResponse.json({ success: false, error: 'Failed to send message' });
  }
}
