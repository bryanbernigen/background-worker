import type { Notify, Recipient } from '@/lib/jobs/types';

export interface NotificationChannel {
  sendText(to: string, msg: string): Promise<boolean>;
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
