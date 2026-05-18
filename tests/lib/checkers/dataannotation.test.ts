import { describe, it, expect } from 'vitest';
import { parseDataAnnotation, extractPaidItems } from '@/lib/checkers/dataannotation/parse';
import { diffItems } from '@/lib/checkers/dataannotation/diff';
import { formatNotification } from '@/lib/checkers/dataannotation/format';
import type { PaidItem } from '@/lib/checkers/types';

const sampleProps = {
  reportableProjectsInfo: [
    { id: '1', name: 'Project A', pay: '$40.00/hr', availableTasksFor: '5', created: '2026-05-01', qualification: false },
  ],
  dashboardMerchTargeting: {
    qualifications: [
      { id: '2', name: 'Qual B', pay: '$25.00/hr', availableTasksFor: '1', created: '2026-05-02', qualification: true },
      { id: '4', name: 'Qual Free', pay: '', availableTasksFor: '1', created: '2026-05-04', qualification: true },
    ],
    projects: [
      { id: '3', name: 'Project C', pay: '$60.00/hr', availableTasksFor: '10', created: '2026-05-03', qualification: false },
    ],
  },
};

describe('parseDataAnnotation', () => {
  it('parses HTML with data-props extracting reportableProjectsInfo', () => {
    const encodedProps = JSON.stringify({
      reportableProjectsInfo: [
        { id: 'dd11293e-3271-40d7-a951-9a8241943caa', name: 'Rate & Review Project', pay: '$40.00/hr', availableTasksFor: '0', created: '2026-05-13T07:33:56.734Z', qualification: false },
      ],
      dashboardMerchTargeting: {
        qualifications: [],
        projects: [],
      },
    });
    const htmlEncoded = encodedProps.replace(/"/g, '&quot;');
    const html = `<div id="workers/WorkerProjectsTable-hybrid-root" data-props="${htmlEncoded}"></div>`;

    const props = parseDataAnnotation(html);
    expect(props).not.toBeNull();
    expect(props!.reportableProjectsInfo).toHaveLength(1);
    expect(props!.dashboardMerchTargeting!.projects).toHaveLength(0);
  });

  it('returns null when div not found', () => {
    const props = parseDataAnnotation('<html><body>no match</body></html>');
    expect(props).toBeNull();
  });
});

describe('extractPaidItems', () => {
  it('extracts projects with pay and ALL qualifications', () => {
    const items = extractPaidItems(sampleProps);
    // Projects with pay: '1', '3' (2). Qualifications: '2', '4' (2, regardless of pay).
    expect(items).toHaveLength(4);
    expect(items.map(i => i.id)).toEqual(['1', '3', '2', '4']);
  });

  it('filters out unpaid projects but includes unpaid qualifications', () => {
    const props = {
      dashboardMerchTargeting: {
        qualifications: [
          { id: 'qual1', name: 'Free Qual', pay: '', availableTasksFor: '1', created: '2026-05-01', qualification: true },
        ],
        projects: [
          { id: 'proj1', name: 'Free Project', pay: '', availableTasksFor: '0', created: '2026-05-01', qualification: false },
        ],
      },
    };
    const items = extractPaidItems(props);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('qual1');
  });
});

describe('diffItems', () => {
  it('identifies new items', () => {
    const current: PaidItem[] = [
      { id: '1', name: 'A', pay: '$10', availableTasksFor: '1', created: '', qualification: false },
      { id: '2', name: 'B', pay: '$20', availableTasksFor: '2', created: '', qualification: false },
    ];
    const previous: PaidItem[] = [
      { id: '1', name: 'A', pay: '$10', availableTasksFor: '1', created: '', qualification: false },
    ];

    const diff = diffItems(current, previous);
    expect(diff.newItems).toHaveLength(1);
    expect(diff.newItems[0].id).toBe('2');
    expect(diff.removedIds).toHaveLength(0);
  });
});

describe('formatNotification', () => {
  it('formats projects correctly', () => {
    const items: PaidItem[] = [
      { id: '1', name: 'Test Project', pay: '$50.00/hr', availableTasksFor: '3', created: '2026-05-01', qualification: false },
    ];
    const msg = formatNotification(items);
    expect(msg).toContain('Test Project');
    expect(msg).toContain('$50.00/hr');
    expect(msg).toContain('3');
    expect(msg).toContain('Auto Checker');
  });

  it('formats qualifications without pay correctly', () => {
    const items: PaidItem[] = [
      { id: '2', name: 'Free Qual', pay: '', availableTasksFor: '2', created: '2026-05-01', qualification: true },
    ];
    const msg = formatNotification(items);
    expect(msg).toContain('Free Qual');
    expect(msg).not.toContain('💰'); // no pay
  });
});
