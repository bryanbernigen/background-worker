import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/access/role';
import { getAdminContactPhone } from '@/lib/access/settings';
import { wahaChannelFromEnv } from '@/lib/notify';

export async function POST() {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  const phone = await getAdminContactPhone();
  const channel = wahaChannelFromEnv();
  if (!phone || !channel) return NextResponse.json({ error: 'Set an admin contact phone and configure WAHA first.' }, { status: 400 });
  let sent = false;
  try { sent = await channel.sendText(phone, '✅ Test message from Background Worker'); }
  catch (e) { console.error('[notifications] test send failed', e); }
  return sent ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Delivery failed' }, { status: 502 });
}
