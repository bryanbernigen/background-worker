import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from '@/lib/auth';
import DaCheckerPage from '@/components/da-checker-page';

export default async function DataAnnotationPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect('/');

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">← Dashboard</a>
        </div>
        <div className="mb-2">
          <h1 className="text-2xl font-bold">Data Annotation</h1>
          <p className="text-xs text-gray-400 font-mono">/dashboard/data-annotation</p>
        </div>
        <DaCheckerPage />
      </div>
    </div>
  );
}
