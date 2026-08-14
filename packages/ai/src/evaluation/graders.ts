import type { CompletionResult } from "../provider/types";

import type { Grader } from "./types";

function textOf(result: CompletionResult): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ");
}

/** Passes when the completion's text content contains `expected` (case-insensitive). */
export function containsText(expected: string): Grader {
  return (result) => {
    const passed = textOf(result)
      .toLowerCase()
      .includes(expected.toLowerCase());
    return {
      passed,
      details: passed ? undefined : `Expected text to contain "${expected}".`,
    };
  };
}

/** Passes when the completion requested the given tool at least once. */
export function usesTool(toolName: string): Grader {
  return (result) => {
    const passed = result.content.some(
      (block) => block.type === "tool_use" && block.name === toolName,
    );
    return {
      passed,
      details: passed
        ? undefined
        : `Expected a tool_use call to "${toolName}".`,
    };
  };
}

/** Passes when the completion ended with the given stop reason. */
export function stopsWith(stopReason: CompletionResult["stopReason"]): Grader {
  return (result) => {
    const passed = result.stopReason === stopReason;
    return {
      passed,
      details: passed
        ? undefined
        : `Expected stopReason "${stopReason}", got "${result.stopReason}".`,
    };
  };
}
