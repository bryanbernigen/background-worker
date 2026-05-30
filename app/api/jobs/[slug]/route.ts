import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';
import { decrypt } from '@/lib/crypto';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug } = await params;

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  // Convention: any field ending in `_encrypted` produces a `_preview` sibling
  // (masked first/last chars) on the wire. The raw ciphertext OR plaintext
  // are never sent to the client.
  const custom = (job.customSettings ?? {}) as Record<string, unknown>;
  const customOut: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(custom)) {
    if (k.endsWith('_encrypted') && typeof v === 'string') {
      try {
        const plain = decrypt(v);
        const previewKey = k.replace(/_encrypted$/, '_preview');
        customOut[previewKey] = mask(plain);
      } catch { /* unreadable secret — omit preview */ }
    } else {
      customOut[k] = v;
    }
  }

  return NextResponse.json({
    job: {
      id: job.id, slug: job.slug,
      title: job.title, url: job.url, description: job.description,
      minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
      dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
      enabled: job.enabled,
      nextRunAt: job.nextRunAt, lastRunAt: job.lastRunAt,
      custom: customOut,
    },
  });
}

function mask(s: string): string {
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)`;
}
