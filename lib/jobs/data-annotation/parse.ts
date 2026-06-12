import type { PaidItem } from '@/lib/jobs/types';

interface DataAnnotationProps {
  // NOTE: reportableProjectsInfo is intentionally NOT scraped. It is a separate
  // "projects you can report time on" list that the dashboard table never renders
  // (the table is built from dashboardMerchTargeting only). Including it caused
  // items like "Eevee" to be notified despite never appearing on the dashboard.
  dashboardMerchTargeting?: {
    qualifications?: PaidItem[];
    projects?: PaidItem[];
  };
}

export function parseDataAnnotation(html: string): DataAnnotationProps | null {
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

function hasTasks(s: string): boolean {
  return parseInt(s.replace(/\D/g, '') || '0', 10) > 0;
}

export function extractPaidItems(props: DataAnnotationProps): PaidItem[] {
  const items: PaidItem[] = [];

  if (props.dashboardMerchTargeting?.projects) {
    items.push(...props.dashboardMerchTargeting.projects.filter(i => hasTasks(i.availableTasksFor)));
  }
  if (props.dashboardMerchTargeting?.qualifications) {
    items.push(...props.dashboardMerchTargeting.qualifications.filter(i => hasTasks(i.availableTasksFor)));
  }

  const seen = new Set<string>();
  return items.filter(i => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

export function isPaidItem(item: PaidItem): boolean {
  return !!item.pay?.includes('$');
}
