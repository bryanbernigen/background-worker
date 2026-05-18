'use client';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/card';
import Input from '@/components/ui/input';
import Button from '@/components/ui/button';

export default function SettingsForm() {
  const [cookie, setCookie] = useState('');
  const [waRecipient, setWaRecipient] = useState('');
  const [cookieSaved, setCookieSaved] = useState(false);
  const [waSaved, setWaSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(data => {
      setCookie(data.cookie ?? '');
      setWaRecipient(data.waRecipient ?? '');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const saveCookie = async () => {
    await fetch('/api/settings/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie }),
    });
    setCookieSaved(true);
    setTimeout(() => setCookieSaved(false), 2000);
  };

  const saveWaRecipient = async () => {
    await fetch('/api/settings/wa-recipient', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waRecipient }),
    });
    setWaSaved(true);
    setTimeout(() => setWaSaved(false), 2000);
  };

  const sendTestWhatsApp = async () => {
    setTestResult(null);
    const res = await fetch('/api/settings/test-whatsapp', { method: 'POST' });
    const data = await res.json();
    setTestResult(data.success
      ? { type: 'success', msg: 'Test message sent!' }
      : { type: 'error', msg: data.error ?? 'Failed to send' }
    );
  };

  if (loading) {
    return <p className="text-gray-500">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold mb-4">DataAnnotation Cookie</h2>
        <p className="text-sm text-gray-500 mb-3">
          Paste the full cookie string from your browser dev tools (Headers &gt; Request Headers &gt; Cookie).
        </p>
        <textarea
          value={cookie}
          onChange={e => setCookie(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
          placeholder="cookieyes-consent=...; conv_session=...; gondor-main=..."
        />
        <div className="mt-3">
          <Button onClick={saveCookie} className="bg-blue-600 text-white hover:bg-blue-700">
            {cookieSaved ? 'Saved!' : 'Save Cookie'}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold mb-4">WhatsApp Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Recipient Phone (with country code, no +)
            </label>
            <Input
              value={waRecipient}
              onChange={e => setWaRecipient(e.target.value)}
              placeholder="6281234567890"
            />
            <div className="mt-2">
              <Button onClick={saveWaRecipient} className="bg-blue-600 text-white hover:bg-blue-700">
                {waSaved ? 'Saved!' : 'Save Recipient'}
              </Button>
            </div>
          </div>

          <div className="pt-4 border-t">
            <Button onClick={sendTestWhatsApp} className="bg-green-600 text-white hover:bg-green-700">
              Send Test WhatsApp
            </Button>
            {testResult && (
              <p className={`mt-2 text-sm ${testResult.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {testResult.msg}
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
