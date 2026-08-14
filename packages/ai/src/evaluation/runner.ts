import { createLogger } from "../logging/logger";
import type { ModelProvider } from "../provider/types";

import type { EvalCase, EvalCaseResult, EvalSuiteResult } from "./types";

const logger = createLogger("evaluation.runner");

/**
 * Runs a suite of eval cases against any ModelProvider — including
 * NotConfiguredModelProvider or a hand-rolled test double, since the
 * framework itself doesn't need a real model to be useful (writing/wiring
 * eval cases can happen now; running them against a real provider's output
 * is possible the moment one is configured, with zero changes here).
 * A failing case's error is captured as a failed result rather than
 * aborting the whole suite, so one bad case doesn't hide the rest.
 */
export async function runEvalSuite(
  cases: EvalCase[],
  modelProvider: ModelProvider,
): Promise<EvalSuiteResult> {
  const results: EvalCaseResult[] = [];

  for (const evalCase of cases) {
    const start = Date.now();
    try {
      const result = await modelProvider.complete(evalCase.input);
      const graded = evalCase.grade(result);
      const passed = typeof graded === "boolean" ? graded : graded.passed;
      const details = typeof graded === "boolean" ? undefined : graded.details;

      results.push({
        name: evalCase.name,
        passed,
        details,
        result,
        durationMs: Date.now() - start,
      });

      logger.info("eval case finished", {
        name: evalCase.name,
        passed,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err);
      results.push({
        name: evalCase.name,
        passed: false,
        details,
        result: { content: [], stopReason: "unknown" },
        durationMs: Date.now() - start,
      });
      logger.error("eval case errored", {
        name: evalCase.name,
        error: details,
      });
    }
  }

  const passed = results.filter((r) => r.passed).length;

  return {
    cases: results,
    passed,
    failed: results.length - passed,
    total: results.length,
    passRate: results.length === 0 ? 0 : passed / results.length,
  };
}
