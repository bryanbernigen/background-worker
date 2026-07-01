'use client';
import { useState } from 'react';

export default function ContactAdmin() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(''); const [contact, setContact] = useState(''); const [message, setMessage] = useState('');
  const [company, setCompany] = useState(''); // honeypot
  const [msg, setMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    setSending(true); setMsg(null);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, contact, message, company }),
      });
      if (res.ok) { setMsg('Sent — the admin will get back to you.'); setName(''); setContact(''); setMessage(''); }
      else { const b = await res.json().catch(() => ({})); setMsg(b.error ?? `Failed (${res.status})`); }
    } finally { setSending(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">
        Request full access
      </button>
    );
  }
  return (
    <div className="border rounded-lg bg-white shadow-sm p-4 w-full max-w-md space-y-2">
      <h3 className="font-semibold">Request full access</h3>
      <input className="border rounded px-2 py-1 text-sm w-full" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
      <input className="border rounded px-2 py-1 text-sm w-full" placeholder="How to reach you (email / WhatsApp)" value={contact} onChange={e => setContact(e.target.value)} />
      <textarea className="border rounded px-2 py-1 text-sm w-full" placeholder="Message" rows={3} value={message} onChange={e => setMessage(e.target.value)} />
      <input tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={company} onChange={e => setCompany(e.target.value)} />
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={sending || !name || !contact || !message}
          className="text-sm px-3 py-1.5 rounded bg-green-600 text-white disabled:bg-gray-300">
          {sending ? 'Sending…' : 'Send'}
        </button>
        <button onClick={() => setOpen(false)} className="text-sm px-3 py-1.5 rounded border">Cancel</button>
      </div>
      {msg && <div className="text-sm text-gray-600">{msg}</div>}
    </div>
  );
}
