import { NextRequest, NextResponse } from 'next/server';
import { validateContact, checkRateLimit, formatContactMessage, ContactError } from '@/lib/contact';
import { getAdminContactPhone } from '@/lib/access/settings';
import { getWahaChannel } from '@/lib/waha-config';

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (!checkRateLimit(ip)) return NextResponse.json({ error: 'Too many requests — try again later.' }, { status: 429 });

  let parsed;
  try { parsed = validateContact(await req.json().catch(() => null)); }
  catch (e) {
    if (e instanceof ContactError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (parsed.kind === 'honeypot') return NextResponse.json({ ok: true }); // silently drop bots

  const phone = await getAdminContactPhone();
  const channel = await getWahaChannel();
  if (!phone || !channel) return NextResponse.json({ error: 'Contact is unavailable right now.' }, { status: 503 });

  let sent = false;
  try { sent = await channel.sendText(phone, formatContactMessage(parsed.input)); }
  catch (e) { console.error('[contact] send failed', e); }
  if (!sent) return NextResponse.json({ error: 'Delivery failed — please try another channel.' }, { status: 502 });

  return NextResponse.json({ ok: true });
}
