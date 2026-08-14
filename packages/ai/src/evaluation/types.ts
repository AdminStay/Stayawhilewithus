import type { CompletionInput, CompletionResult } from "../provider/types";

export interface GradeResult {
  passed: boolean;
  details?: string;
}

export type Grader = (result: CompletionResult) => GradeResult | boolean;

export interface EvalCase {
  name: string;
  input: CompletionInput;
  grade: Grader;
}

export interface EvalCaseResult {
  name: string;
  passed: boolean;
  details?: string;
  result: CompletionResult;
  durationMs: number;
}

export interface EvalSuiteResult {
  cases: EvalCaseResult[];
  passed: number;
  failed: number;
  total: number;
  passRate: number;
}
