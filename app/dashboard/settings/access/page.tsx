import { notFound } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
import { isGuestModeEnabled, getAdminContactPhone } from '@/lib/access/settings';
import AccessForm from './access-form';

export default async function AccessSettingsPage() {
  const role = await resolveRole();
  if (role !== 'admin') return notFound();
  const guestMode = await isGuestModeEnabled();
  const adminContactPhone = await getAdminContactPhone();
  return (
    <div className="max-w-xl mx-auto p-8 space-y-6">
      <a href="/dashboard" className="text-sm text-muted hover:text-text">← Console</a>
      <h1 className="text-2xl font-semibold">Access</h1>
      <AccessForm initial={{ guestMode, adminContactPhone: adminContactPhone ?? '' }} />
    </div>
  );
}
