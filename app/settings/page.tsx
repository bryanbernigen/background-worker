import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from '@/lib/auth';
import SettingsForm from '@/components/settings-form';

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  const session = token ? verifySessionToken(token) : null;

  if (!session) {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Settings</h1>
          <a href="/dashboard" className="text-sm text-blue-600 hover:underline">Back to Dashboard</a>
        </div>
        <SettingsForm />
      </div>
    </div>
  );
}
