// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopyableId, truncateId } from "./CopyableId";

afterEach(cleanup);

describe("truncateId", () => {
  it("leaves a short value completely unchanged", () => {
    expect(truncateId("lock-abc")).toBe("lock-abc");
  });

  it("truncates a real 32-char August external device ID to head…tail", () => {
    expect(truncateId("5AA08B0442EF407DB7243D4623EE2968")).toBe(
      "5AA08B04…E2968",
    );
  });
});

describe("CopyableId", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it("shows the truncated value visually but the full value in the title tooltip — the underlying value is never altered", () => {
    const full = "5AA08B0442EF407DB7243D4623EE2968";
    render(<CopyableId value={full} />);

    expect(screen.getByText("5AA08B04…E2968")).toBeTruthy();
    expect(screen.getByTitle(full)).toBeTruthy();
  });

  it("renders a short value in full, with no truncation", () => {
    render(<CopyableId value="house-xyz" />);

    expect(screen.getByText("house-xyz")).toBeTruthy();
  });

  it("copies the complete, untruncated value to the clipboard", async () => {
    const full = "5AA08B0442EF407DB7243D4623EE2968";
    render(<CopyableId value={full} />);

    fireEvent.click(screen.getByRole("button", { name: `Copy ${full}` }));
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith(full);
  });
});
