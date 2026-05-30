import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { jobRegistry } from './registry';

export async function seedRegistryJobs(): Promise<void> {
  for (const mod of jobRegistry) {
    const [existing] = await db.select().from(jobs).where(eq(jobs.slug, mod.slug)).limit(1);
    if (existing) continue;
    await db.insert(jobs).values({
      slug: mod.slug,
      title: mod.defaultMeta.title,
      url: mod.defaultMeta.url,
      description: mod.defaultMeta.description,
    });
    console.log(`[seed] inserted job '${mod.slug}'`);
  }
  // Orphans (DB rows with a slug no longer in the registry) are left alone.
}
