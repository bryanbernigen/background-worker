import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from '@/lib/auth';
import GlobalSettingsForm from '@/components/global-settings-form';

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect('/');

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">← Dashboard</a>
        </div>
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        <GlobalSettingsForm />
      </div>
    </div>
  );
}
