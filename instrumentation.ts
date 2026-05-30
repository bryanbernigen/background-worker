// Runs once per Next.js server instance boot, before serving requests.
// Node runtime only (skipped on Edge).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { runMigrations } = await import('./lib/db/migrate');
  const { seedRegistryJobs } = await import('./lib/jobs/seed');
  const { start } = await import('./lib/scheduler');

  await runMigrations();
  await seedRegistryJobs();
  await start();
}
