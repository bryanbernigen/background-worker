import { notFound } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
import { listJobTypes } from '@/lib/jobs/registry';
import NewJobForm from './new-job-form';

export default async function NewJobPage() {
  const role = await resolveRole();
  if (role !== 'admin') return notFound();
  const types = listJobTypes().map(t => ({ type: t.type, title: t.defaultMeta.title }));
  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <a href="/dashboard" className="text-sm text-muted hover:text-text">← Console</a>
      <h1 className="text-2xl font-semibold">New job</h1>
      <NewJobForm types={types} />
    </div>
  );
}
