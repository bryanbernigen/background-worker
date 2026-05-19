import type { PaidItem } from '../types';

interface DataAnnotationProps {
  reportableProjectsInfo?: PaidItem[];
  dashboardMerchTargeting?: {
    qualifications?: PaidItem[];
    projects?: PaidItem[];
  };
}

export function parseDataAnnotation(html: string): DataAnnotationProps | null {
  // Extract data-props from the specific div
  // The data-props attribute value is HTML-encoded (quotes become &quot;)
  const match = html.match(/id="workers\/WorkerProjectsTable-hybrid-root"\s+data-props="([^"]+)"/);
  if (!match) return null;

  const encoded = match[1];
  const decoded = decodeURIComponent(encoded
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
  );

  try {
    return JSON.parse(decoded);
  } catch (err) {
    console.error('[DataAnnotation] Parse error:', err);
    return null;
  }
}

export function extractPaidItems(props: DataAnnotationProps): PaidItem[] {
  const items: PaidItem[] = [];

  // reportableProjectsInfo — only those with pay AND tasks
  if (props.reportableProjectsInfo) {
    items.push(...props.reportableProjectsInfo.filter(i => {
      if (!i.pay || !i.pay.includes('$')) return false;
      const count = parseInt(i.availableTasksFor.replace(/\D/g, '') || '0', 10);
      return count > 0;
    }));
  }

  // dashboardMerchTargeting.projects — only those with pay AND tasks
  if (props.dashboardMerchTargeting?.projects) {
    items.push(...props.dashboardMerchTargeting.projects.filter(i => {
      if (!i.pay || !i.pay.includes('$')) return false;
      const count = parseInt(i.availableTasksFor.replace(/\D/g, '') || '0', 10);
      return count > 0;
    }));
  }

  // dashboardMerchTargeting.qualifications — only if they have tasks
  if (props.dashboardMerchTargeting?.qualifications) {
    items.push(...props.dashboardMerchTargeting.qualifications.filter(i => {
      const count = parseInt(i.availableTasksFor.replace(/\D/g, '') || '0', 10);
      return count > 0;
    }));
  }

  return items;
}
