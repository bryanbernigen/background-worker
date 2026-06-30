import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { jobRegistry } from './registry';

/**
 * Phase 1: seed one instance per registered type if absent, keyed by slug == type.
 * (Phase 2 removes auto-seeding in favour of admin-created instances.)
 */
export async function seedRegistryJobs(): Promise<void> {
  for (const mod of jobRegistry) {
    const [existing] = await db.select().from(jobs).where(eq(jobs.slug, mod.type)).limit(1);
    if (existing) continue;
    await db.insert(jobs).values({
      slug: mod.type,
      type: mod.type,
      title: mod.defaultMeta.title,
      url: mod.defaultMeta.url,
      description: mod.defaultMeta.description,
    });
    console.log(`[seed] inserted job '${mod.type}'`);
  }
}
