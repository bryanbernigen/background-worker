import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/access/role';
import { wahaConfigStatus, applyWahaPatch } from '@/lib/waha-config';

export async function GET() {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  return NextResponse.json(await wahaConfigStatus());
}

const patch = z.object({
  wahaUrl:     z.string().url().nullable().optional(),
  wahaApiKey:  z.string().nullable().optional(),
  wahaSession: z.string().min(1).nullable().optional(),
}).strict();

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  const parsed = patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  await applyWahaPatch(parsed.data);
  return NextResponse.json({ ok: true });
}
