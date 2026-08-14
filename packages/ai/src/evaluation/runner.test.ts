import { describe, expect, it, vi } from "vitest";

import type { ModelProvider, CompletionResult } from "../provider/types";

import { containsText, stopsWith, usesTool } from "./graders";
import { runEvalSuite } from "./runner";
import type { EvalCase } from "./types";

function fakeProvider(result: CompletionResult): ModelProvider {
  return {
    complete: vi.fn(async () => result),
    completeStream: vi.fn(),
  };
}

describe("runEvalSuite", () => {
  it("runs every case and reports pass/fail counts and rate", async () => {
    const client = fakeProvider({
      content: [{ type: "text", text: "The wifi password is on the fridge." }],
      stopReason: "end_turn",
    });
    const cases: EvalCase[] = [
      {
        name: "mentions fridge",
        input: { system: "sys", messages: [] },
        grade: containsText("fridge"),
      },
      {
        name: "mentions pool (will fail)",
        input: { system: "sys", messages: [] },
        grade: containsText("pool"),
      },
    ];

    const suite = await runEvalSuite(cases, client);

    expect(suite.total).toBe(2);
    expect(suite.passed).toBe(1);
    expect(suite.failed).toBe(1);
    expect(suite.passRate).toBe(0.5);
    expect(suite.cases[0]).toEqual(
      expect.objectContaining({ name: "mentions fridge", passed: true }),
    );
    expect(suite.cases[1]).toEqual(
      expect.objectContaining({
        name: "mentions pool (will fail)",
        passed: false,
        details: expect.stringContaining("pool"),
      }),
    );
  });

  it("captures a thrown error as a failed case instead of aborting the suite", async () => {
    const client: ModelProvider = {
      complete: vi.fn().mockRejectedValueOnce(new Error("rate limited")),
      completeStream: vi.fn(),
    };
    const cases: EvalCase[] = [
      {
        name: "errors",
        input: { system: "sys", messages: [] },
        grade: () => true,
      },
    ];

    const suite = await runEvalSuite(cases, client);

    expect(suite.passed).toBe(0);
    expect(suite.failed).toBe(1);
    expect(suite.cases[0]?.details).toBe("rate limited");
  });

  it("returns a passRate of 0 for an empty suite rather than NaN", async () => {
    const suite = await runEvalSuite(
      [],
      fakeProvider({ content: [], stopReason: "end_turn" }),
    );

    expect(suite).toEqual(
      expect.objectContaining({ total: 0, passed: 0, failed: 0, passRate: 0 }),
    );
  });
});

describe("graders", () => {
  it("usesTool passes only when the named tool was called", () => {
    const withTool: CompletionResult = {
      content: [
        { type: "tool_use", id: "t1", name: "properties.list", input: {} },
      ],
      stopReason: "tool_use",
    };
    const withoutTool: CompletionResult = {
      content: [{ type: "text", text: "no tools here" }],
      stopReason: "end_turn",
    };

    expect(usesTool("properties.list")(withTool)).toEqual({ passed: true });
    const failed = usesTool("properties.list")(withoutTool);
    expect(failed).toMatchObject({ passed: false });
  });

  it("stopsWith passes only when the stop reason matches", () => {
    const result: CompletionResult = { content: [], stopReason: "tool_use" };

    expect(stopsWith("tool_use")(result)).toEqual({ passed: true });
    expect(stopsWith("end_turn")(result)).toMatchObject({ passed: false });
  });
});
