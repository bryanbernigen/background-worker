import { WahaClient } from '@/lib/waha';
import type { Notify, Recipient } from '@/lib/jobs/types';

export interface NotificationChannel {
  sendText(to: string, msg: string): Promise<boolean>;
}

/** The single global WhatsApp sender, or null when WAHA isn't configured. */
export function wahaChannelFromEnv(): NotificationChannel | null {
  const url = process.env.WAHA_URL;
  if (!url) return null;
  const waha = new WahaClient(url, process.env.WAHA_API_KEY ?? '');
  return { sendText: (to, msg) => waha.sendText(to, msg) };
}

/** Build a Notify that fans a message out to recipients (optionally filtered by tag). */
export function buildNotifier(recipients: Recipient[], channel: NotificationChannel | null): Notify {
  return async (message, opts) => {
    if (!channel) return false;
    const targets = opts?.tag ? recipients.filter(r => r.tag === opts.tag) : recipients;
    let sent = false;
    for (const r of targets) {
      try { sent = (await channel.sendText(r.phone, message)) || sent; }
      catch (e) { console.error(`[notify] send failed for ${r.phone}`, e); }
    }
    return sent;
  };
}
