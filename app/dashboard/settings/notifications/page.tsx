import { notFound } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
import { getAdminContactPhone } from '@/lib/access/settings';
import TestButton from './test-button';

export default async function NotificationsSettingsPage() {
  const role = await resolveRole();
  if (role !== 'admin') return notFound();
  const wahaConfigured = !!process.env.WAHA_URL;
  const phone = await getAdminContactPhone();

  return (
    <div className="max-w-xl mx-auto p-8 space-y-6">
      <a href="/dashboard" className="text-sm text-muted hover:text-text">← Console</a>
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <div className="space-y-3 border border-border rounded-lg p-4 bg-surface text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted">WhatsApp sender (WAHA)</span>
          <span className={wahaConfigured ? 'text-ok' : 'text-off'}>{wahaConfigured ? 'configured' : 'not configured'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Admin contact phone</span>
          <span className="font-mono">{phone ?? '—'}</span>
        </div>
        <p className="text-muted">If messages stop sending, the WAHA session may need a QR re-scan on the WAHA host.</p>
        <TestButton disabled={!wahaConfigured || !phone} />
      </div>
    </div>
  );
}
