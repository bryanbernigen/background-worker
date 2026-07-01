import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/access/role';
import { listJobTypes } from '@/lib/jobs/registry';

export async function GET() {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  return NextResponse.json({ types: listJobTypes() });
}
