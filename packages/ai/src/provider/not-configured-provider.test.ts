import { describe, expect, it } from "vitest";

import { NotConfiguredModelProvider } from "./not-configured-provider";

describe("NotConfiguredModelProvider", () => {
  it("complete() throws NotImplementedError", async () => {
    const provider = new NotConfiguredModelProvider();

    await expect(
      provider.complete({ system: "sys", messages: [] }),
    ).rejects.toThrow(/not implemented yet/i);
  });

  it("completeStream() throws NotImplementedError", () => {
    const provider = new NotConfiguredModelProvider();

    expect(() =>
      provider.completeStream({ system: "sys", messages: [] }),
    ).toThrow(/not implemented yet/i);
  });
});
