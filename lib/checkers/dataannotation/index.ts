import { fetchDataAnnotationPage } from './fetch';
import { parseDataAnnotation, extractPaidItems } from './parse';
import { diffItems, type DiffResult } from './diff';
import { formatNotification } from './format';
import { kvGet, kvSet } from '@/lib/kv';
import { WahaClient } from '@/lib/waha';
import type { Checker, PaidItem } from '../types';

interface LastSeen {
  items: PaidItem[];
  updatedAt: string;
}

export const dataAnnotationChecker: Checker = {
  name: 'DataAnnotation',

  async run(): Promise<{ checkerName: string; newItems: PaidItem[]; errors: string[] }> {
    const errors: string[] = [];

    // 1. Get cookie
    const cookie = await kvGet<string>('da_cookie');
    if (!cookie) {
      return { checkerName: 'DataAnnotation', newItems: [], errors: ['No cookie configured'] };
    }

    // 2. Fetch
    let html: string;
    try {
      html = await fetchDataAnnotationPage(cookie);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('401') || msg.includes('403')) {
        return { checkerName: 'DataAnnotation', newItems: [], errors: ['Auth expired — please update cookie'] };
      }
      return { checkerName: 'DataAnnotation', newItems: [], errors: [`Fetch failed: ${msg}`] };
    }

    // 3. Parse
    const props = parseDataAnnotation(html);
    if (!props) {
      return { checkerName: 'DataAnnotation', newItems: [], errors: ['Failed to parse response'] };
    }

    const currentItems = extractPaidItems(props);

    // 4. Diff against last seen
    const lastSeen = await kvGet<LastSeen>('da_last_seen');
    const previousItems = lastSeen?.items ?? [];
    const diff: DiffResult = diffItems(currentItems, previousItems);

    // 5. Update last seen
    await kvSet('da_last_seen', {
      items: currentItems,
      updatedAt: new Date().toISOString(),
    });

    // 6. Send WhatsApp if new items
    if (diff.newItems.length > 0) {
      const waRecipient = await kvGet<string>('wa_recipient');
      if (waRecipient) {
        const wahaUrl = process.env.WAHA_URL;
        const wahaKey = process.env.WAHA_API_KEY ?? '';
        if (wahaUrl) {
          const waha = new WahaClient(wahaUrl, wahaKey);
          const msg = formatNotification(diff.newItems);
          await waha.sendText(waRecipient, msg);
        }
      }
    }

    // 7. Log activity
    const activity = await kvGet<Array<{ timestamp: string; type: string; message: string }>>('activity_log') ?? [];
    activity.unshift({
      timestamp: new Date().toISOString(),
      type: diff.newItems.length > 0 ? 'new_item' : 'check',
      message: diff.newItems.length > 0
        ? `Found ${diff.newItems.length} new item(s)`
        : 'Checked — no new items',
    });
    await kvSet('activity_log', activity.slice(0, 50));

    return {
      checkerName: 'DataAnnotation',
      newItems: diff.newItems,
      errors,
    };
  },
};
