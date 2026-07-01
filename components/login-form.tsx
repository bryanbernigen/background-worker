'use client';
import { useState } from 'react';

export default function LoginForm() {
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const form = e.currentTarget;
    const username = (form.elements.namedItem('username') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      if (res.redirected) {
        window.location.href = res.url;
      } else if (!res.ok) {
        setError('Invalid username or password');
      }
    } catch {
      setError('Something went wrong');
    }
  };

  return (
    <div className="w-full max-w-sm bg-surface border border-border rounded-lg p-8">
      <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-accent text-center mb-1">Console</div>
      <h1 className="text-2xl font-semibold text-center mb-6">Background Worker</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-muted mb-1">Username</label>
          <input
            type="text"
            name="username"
            className="w-full px-3 py-2 bg-surface-2 border border-border text-text rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted mb-1">Password</label>
          <input
            type="password"
            name="password"
            className="w-full px-3 py-2 bg-surface-2 border border-border text-text rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
            required
          />
        </div>
        {error && <p className="text-error text-sm">{error}</p>}
        <button
          type="submit"
          className="w-full bg-accent text-bg font-medium py-2 px-4 rounded-md hover:opacity-90"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
