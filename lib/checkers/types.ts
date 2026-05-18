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
}

export interface Checker {
  name: string;
  run(): Promise<CheckerResult>;
}
