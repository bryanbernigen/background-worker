export interface PaidItem {
  id: string;
  name: string;
  pay: string;
  availableTasksFor: string;
  created: string;
  qualification: boolean;
}

export interface CheckerResult {
  checkerName: string;
  newItems: PaidItem[];
  errors: string[];
  debug?: {
    htmlLen: number;
    reportableProjectsInfo: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[];
    merchProjects: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[];
    merchQuals: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[];
    extracted: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[];
  };
}

export interface Checker {
  name: string;
  run(): Promise<CheckerResult>;
}
