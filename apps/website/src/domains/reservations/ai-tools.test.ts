import { describe, expect, it, vi } from "vitest";

// See properties/ai-tools.test.ts for why @stayw/ai is faked rather than
// imported for real here — this test is about this domain's wiring, not
// @stayw/ai's own registry/execution-engine behavior (covered by that
// package's own tests).
vi.mock("@stayw/ai", () => {
  const tools = new Map<
    string,
    {
      inputSchema: { parse: (i: unknown) => unknown };
      handler: (input: unknown, ctx: unknown) => Promise<unknown>;
    }
  >();
  return {
    registerTool: vi.fn((def) => tools.set(def.name, def)),
    executeTool: vi.fn(async (name: string, input: unknown, ctx: unknown) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`No tool registered named "${name}".`);
      const parsedInput = tool.inputSchema.parse(input);
      const output = await tool.handler(parsedInput, ctx);
      return { status: "executed", output };
    }),
  };
});

vi.mock("./services/reservations.service", () => ({
  listReservations: vi.fn(),
  updateReservationStatus: vi.fn(),
}));

import { executeTool } from "@stayw/ai";

import { registerReservationsAiTools } from "./ai-tools";
import {
  listReservations,
  updateReservationStatus,
} from "./services/reservations.service";

registerReservationsAiTools();

describe("reservations.list AI tool", () => {
  it("executes directly (no approval) and delegates to listReservations", async () => {
    vi.mocked(listReservations).mockResolvedValueOnce([{ id: "r1" }] as never);

    const result = await executeTool(
      "reservations.list",
      {},
      { userId: "user-1" },
    );

    expect(listReservations).toHaveBeenCalledWith({ userId: "user-1" });
    expect(result).toEqual({ status: "executed", output: [{ id: "r1" }] });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(executeTool("reservations.list", {}, {})).rejects.toThrow(
      /requires an authenticated userId/,
    );
    expect(listReservations).not.toHaveBeenCalled();
  });
});

describe("reservations.updateStatus AI tool", () => {
  it("delegates to updateReservationStatus with the id split out of the input", async () => {
    vi.mocked(updateReservationStatus).mockResolvedValueOnce({
      id: "r1",
      status: "CANCELLED",
    } as never);

    const result = await executeTool(
      "reservations.updateStatus",
      { reservationId: "r1", status: "CANCELLED" },
      { userId: "user-1" },
    );

    expect(updateReservationStatus).toHaveBeenCalledWith(
      { userId: "user-1" },
      "r1",
      { status: "CANCELLED" },
    );
    expect(result).toEqual({
      status: "executed",
      output: { id: "r1", status: "CANCELLED" },
    });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(
      executeTool(
        "reservations.updateStatus",
        { reservationId: "r1", status: "CANCELLED" },
        {},
      ),
    ).rejects.toThrow(/requires an authenticated userId/);
    expect(updateReservationStatus).not.toHaveBeenCalled();
  });
});
