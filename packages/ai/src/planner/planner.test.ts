import { describe, expect, it } from "vitest";

import type { CompletionResult } from "../provider/types";

import {
  extractText,
  extractToolUseBlocks,
  planAfterToolExecution,
  planEscalation,
  planNextStep,
} from "./planner";
import type { ToolExecutionOutcome } from "./types";

describe("planNextStep", () => {
  it("decides to respond when the model didn't request a tool", () => {
    const result: CompletionResult = {
      content: [{ type: "text", text: "The wifi password is on the fridge." }],
      stopReason: "end_turn",
    };

    const decision = planNextStep(result);

    expect(decision).toEqual({
      type: "respond",
      message: "The wifi password is on the fridge.",
    });
  });

  it("joins multiple text blocks with a newline", () => {
    const result: CompletionResult = {
      content: [
        { type: "text", text: "Line one." },
        { type: "text", text: "Line two." },
      ],
      stopReason: "end_turn",
    };

    expect(planNextStep(result)).toEqual({
      type: "respond",
      message: "Line one.\nLine two.",
    });
  });

  it("decides to execute tools when the model requested one", () => {
    const result: CompletionResult = {
      content: [
        { type: "tool_use", id: "t1", name: "properties.list", input: {} },
      ],
      stopReason: "tool_use",
    };

    const decision = planNextStep(result);

    expect(decision).toEqual({
      type: "execute_tools",
      toolUseBlocks: [
        { type: "tool_use", id: "t1", name: "properties.list", input: {} },
      ],
    });
  });

  it("extracts only tool_use blocks, ignoring interleaved text", () => {
    const result: CompletionResult = {
      content: [
        { type: "text", text: "Let me check that." },
        { type: "tool_use", id: "t1", name: "properties.list", input: {} },
      ],
      stopReason: "tool_use",
    };

    expect(extractToolUseBlocks(result)).toEqual([
      { type: "tool_use", id: "t1", name: "properties.list", input: {} },
    ]);
  });
});

describe("extractText", () => {
  it("returns an empty string when there are no text blocks", () => {
    const result: CompletionResult = {
      content: [{ type: "tool_use", id: "t1", name: "x", input: {} }],
      stopReason: "tool_use",
    };

    expect(extractText(result)).toBe("");
  });
});

describe("planAfterToolExecution", () => {
  it("continues when every tool call executed", () => {
    const outcomes: ToolExecutionOutcome[] = [
      {
        block: {
          type: "tool_use",
          id: "t1",
          name: "properties.list",
          input: {},
        },
        status: "executed",
        output: [],
      },
    ];

    expect(planAfterToolExecution(outcomes)).toEqual({ type: "continue" });
  });

  it("pauses for approval when any call is pending, even if others executed", () => {
    const outcomes: ToolExecutionOutcome[] = [
      {
        block: {
          type: "tool_use",
          id: "t1",
          name: "properties.list",
          input: {},
        },
        status: "executed",
        output: [],
      },
      {
        block: {
          type: "tool_use",
          id: "t2",
          name: "reservations.cancel",
          input: {},
        },
        status: "pending_approval",
        actionId: "a1",
      },
    ];

    expect(planAfterToolExecution(outcomes)).toEqual({
      type: "pause_for_approval",
    });
  });

  it("continues when there are no tool outcomes at all", () => {
    expect(planAfterToolExecution([])).toEqual({ type: "continue" });
  });
});

describe("planEscalation", () => {
  it("always recommends escalation with the max_tool_iterations reason", () => {
    expect(planEscalation()).toEqual({
      type: "escalate",
      reason: "max_tool_iterations",
    });
  });
});
