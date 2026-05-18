import { dataAnnotationChecker } from './dataannotation';
import type { Checker } from './types';

export const checkers: Checker[] = [
  dataAnnotationChecker,
];

export type { Checker, PaidItem, CheckerResult } from './types';
