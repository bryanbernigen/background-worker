import type { PaidItem } from '../types';

export function formatNotification(items: PaidItem[]): string {
  // Rule 2: only paid projects + all qualifications
  const paidProjectItems = items.filter(i => !i.qualification && i.pay?.includes('$'));
  const qualItems = items.filter(i => i.qualification);

  let msg = '';

  if (paidProjectItems.length > 0) {
    msg += '🎯 *DataAnnotation — New Paid Projects!*\n\n';
    for (const item of paidProjectItems) {
      msg += `🆕 ${item.name}\n💰 ${item.pay}\n📋 Tasks: ${item.availableTasksFor}\n\n`;
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
