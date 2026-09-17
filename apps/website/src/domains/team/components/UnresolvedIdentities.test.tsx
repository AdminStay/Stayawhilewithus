// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UnresolvedIdentities } from "./UnresolvedIdentities";

afterEach(cleanup);

describe("UnresolvedIdentities", () => {
  it("lists every distinct unresolved identity by name", () => {
    render(<UnresolvedIdentities identities={["Henry", "Heny", "Michelle"]} />);
    expect(screen.getByText("Henry")).toBeTruthy();
    expect(screen.getByText("Heny")).toBeTruthy();
    expect(screen.getByText("Michelle")).toBeTruthy();
  });

  it("shows an all-linked message and no badges when the list is empty", () => {
    render(<UnresolvedIdentities identities={[]} />);
    expect(screen.getByText(/linked to a StayWhile login/)).toBeTruthy();
    expect(screen.queryByText("Henry")).toBeNull();
  });
});
