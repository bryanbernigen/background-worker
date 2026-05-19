'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/card';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';

const CHECKERS = [
  {
    slug: 'data-annotation',
    name: 'Data Annotation',
    description: 'Monitor paid projects and qualifications',
    emoji: '📋',
  },
];

function CheckerCard({ checker }: { checker: typeof CHECKERS[0] }) {
  const [status, setStatus] = useState<string>('unknown');

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => setStatus(d.status ?? 'unknown'))
      .catch(() => setStatus('unknown'));
  }, []);

  const statusColor = status === 'running' ? 'green'
    : status === 'auth_error' ? 'red'
    : status === 'no_cookie' ? 'orange'
    : 'gray';

  return (
    <Card>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{checker.emoji}</span>
          <h2 className="text-lg font-semibold">{checker.name}</h2>
        </div>
        <Badge color={statusColor}>{status}</Badge>
      </div>
      <p className="text-sm text-gray-500 mb-4">{checker.description}</p>
      <Link href={`/dashboard/${checker.slug}`}>
        <Button className="bg-blue-600 text-white hover:bg-blue-700">Open</Button>
      </Link>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Auto Checker</h1>
          <div className="flex gap-4">
            <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-gray-700">Settings</Link>
            <form action="/api/auth/logout" method="POST">
              <button className="text-sm text-gray-500 hover:text-gray-700">Logout</button>
            </form>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {CHECKERS.map(checker => (
            <CheckerCard key={checker.slug} checker={checker} />
          ))}
        </div>
      </div>
    </div>
  );
}
