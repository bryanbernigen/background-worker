import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/api/require-session';
import { listJobTypes } from '@/lib/jobs/registry';

export async function GET() {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  return NextResponse.json({ types: listJobTypes() });
}
