export function filterJobs<T extends { title: string; type: string; slug: string }>(jobs: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return jobs;
  return jobs.filter(j =>
    j.title.toLowerCase().includes(q) ||
    j.type.toLowerCase().includes(q) ||
    j.slug.toLowerCase().includes(q));
}
