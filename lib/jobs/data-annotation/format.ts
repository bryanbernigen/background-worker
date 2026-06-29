import type { PaidItem } from '@/lib/jobs/types';

export function formatNotification(items: PaidItem[]): string {
  const projectItems = items.filter(i => !i.qualification);
  const qualItems = items.filter(i => i.qualification);

  let msg = '';

  if (projectItems.length > 0) {
    msg += '🎯 *DataAnnotation — New Projects!*\n\n';
    for (const item of projectItems) {
      const payLine = item.pay ? `💰 ${item.pay}\n` : '';
      msg += `🆕 ${item.name}\n${payLine}📋 Tasks: ${item.availableTasksFor}\n\n`;
    }
  }

  if (qualItems.length > 0) {
    if (msg) msg += '\n';
    msg += '🎯 *DataAnnotation — New Qualifications!*\n\n';
    for (const item of qualItems) {
      const payLine = item.pay ? `💰 ${item.pay}` : '';
      msg += `🆕 ${item.name}\n${payLine}\n📋 Tasks: ${item.availableTasksFor}\n\n`;
    }
  }

  msg += '---\nSent via Auto Checker';
  return msg;
}
