import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/access/role';
import { isGuestModeEnabled, setGuestMode, getAdminContactPhone, setAdminContactPhone } from '@/lib/access/settings';

export async function GET() {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  return NextResponse.json({ guestMode: await isGuestModeEnabled(), adminContactPhone: await getAdminContactPhone() });
}

const patch = z.object({
  guestMode:         z.boolean().optional(),
  adminContactPhone: z.string().min(5).nullable().optional(),
}).strict();

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  const parsed = patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  if (parsed.data.guestMode !== undefined) await setGuestMode(parsed.data.guestMode);
  if (parsed.data.adminContactPhone !== undefined) await setAdminContactPhone(parsed.data.adminContactPhone);
  return NextResponse.json({ ok: true });
}
