// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperationalHoldButton } from "./OperationalHoldButton";

afterEach(cleanup);

describe("OperationalHoldButton (2026-09-26)", () => {
  it("records a hold with the chosen type and reason; says no command is sent", async () => {
    const setAction = vi.fn().mockResolvedValue({ status: "success" });
    render(
      <OperationalHoldButton
        smartDeviceId="lock-1"
        lockName="Flor Sun - Front Door"
        propertyName="Florisun"
        activeHoldLabel={null}
        setAction={setAction}
        clearAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /hold/i }));
    expect(screen.getByText(/No command is sent/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Out of service/));
    fireEvent.change(screen.getByPlaceholderText(/replacement ordered/i), {
      target: { value: "Lock replacement required." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record hold" }));

    expect(await screen.findByText("Hold recorded.")).toBeTruthy();
    const fd = setAction.mock.calls[0]![1] as FormData;
    expect(fd.get("smartDeviceId")).toBe("lock-1");
    expect(fd.get("kind")).toBe("OUT_OF_SERVICE");
    expect(fd.get("note")).toBe("Lock replacement required.");
  });

  it("with an active hold, offers Clear hold via the clear action", async () => {
    const clearAction = vi.fn().mockResolvedValue({ status: "success" });
    render(
      <OperationalHoldButton
        smartDeviceId="lock-1"
        lockName="Front Door"
        propertyName="Florisun"
        activeHoldLabel="Out of service"
        setAction={vi.fn()}
        clearAction={clearAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /clear hold/i }));
    expect(screen.getByText(/Current hold: Out of service/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Lock replaced/i), {
      target: { value: "Replaced." },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Clear hold" }).at(-1)!,
    );
    expect(await screen.findByText("Hold cleared.")).toBeTruthy();
    expect(clearAction).toHaveBeenCalled();
  });
});
