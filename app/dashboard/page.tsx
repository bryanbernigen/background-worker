import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from '@/lib/auth';
import DashboardCards from '@/components/dashboard-cards';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Auto Checker</h1>
          <div className="flex gap-4">
            <a href="/settings" className="text-sm text-gray-500 hover:text-gray-700">Settings</a>
            <form action="/api/auth/logout" method="POST">
              <button className="text-sm text-gray-500 hover:text-gray-700">Logout</button>
            </form>
          </div>
        </div>
        <DashboardCards />
      </div>
    </div>
  );
}
