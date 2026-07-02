import { notFound } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
import { wahaConfigStatus } from '@/lib/waha-config';
import WahaForm from './waha-form';
import TestButton from './test-button';

export default async function NotificationsSettingsPage() {
  const role = await resolveRole();
  if (role !== 'admin') return notFound();
  const status = await wahaConfigStatus();

  return (
    <div className="max-w-xl mx-auto p-8 space-y-6">
      <a href="/dashboard" className="text-sm text-muted hover:text-text">← Console</a>
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <WahaForm initial={{
        url: status.url ?? '', urlSource: status.urlSource,
        apiKeyPreview: status.apiKeyPreview, apiKeySource: status.apiKeySource,
        session: status.session,
      }} />
      <div className="space-y-3 border border-border rounded-lg p-4 bg-surface text-sm">
        <p className="text-muted">If messages stop sending, the WAHA session may need a QR re-scan on the WAHA host.</p>
        <TestButton disabled={!status.configured} />
      </div>
    </div>
  );
}
