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

vi.mock("./services/guests.service", () => ({
  listGuests: vi.fn(),
  updateGuest: vi.fn(),
}));

import { executeTool } from "@stayw/ai";

import { registerGuestsAiTools } from "./ai-tools";
import { listGuests, updateGuest } from "./services/guests.service";

registerGuestsAiTools();

describe("guests.list AI tool", () => {
  it("executes directly (no approval) and delegates to listGuests", async () => {
    vi.mocked(listGuests).mockResolvedValueOnce([{ id: "g1" }] as never);

    const result = await executeTool("guests.list", {}, { userId: "user-1" });

    expect(listGuests).toHaveBeenCalledWith({ userId: "user-1" });
    expect(result).toEqual({ status: "executed", output: [{ id: "g1" }] });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(executeTool("guests.list", {}, {})).rejects.toThrow(
      /requires an authenticated userId/,
    );
    expect(listGuests).not.toHaveBeenCalled();
  });
});

describe("guests.update AI tool", () => {
  it("delegates to updateGuest with the id split out of the input", async () => {
    vi.mocked(updateGuest).mockResolvedValueOnce({
      id: "g1",
      firstName: "Jo",
    } as never);

    const result = await executeTool(
      "guests.update",
      { guestId: "g1", firstName: "Jo", lastName: "Doe" },
      { userId: "user-1" },
    );

    expect(updateGuest).toHaveBeenCalledWith({ userId: "user-1" }, "g1", {
      firstName: "Jo",
      lastName: "Doe",
    });
    expect(result).toEqual({
      status: "executed",
      output: { id: "g1", firstName: "Jo" },
    });
  });

  it("refuses to run without an authenticated userId", async () => {
    await expect(
      executeTool(
        "guests.update",
        { guestId: "g1", firstName: "Jo", lastName: "Doe" },
        {},
      ),
    ).rejects.toThrow(/requires an authenticated userId/);
    expect(updateGuest).not.toHaveBeenCalled();
  });
});
