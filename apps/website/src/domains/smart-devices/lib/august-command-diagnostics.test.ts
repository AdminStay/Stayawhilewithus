import { HttpRequestError } from "@stayw/integrations/core";
import { describe, expect, it } from "vitest";

import {
  buildAckDiagnostics,
  classifyAugustRequestError,
  safeDiagnosticTimestamp,
  safeDiagnosticToken,
} from "./august-command-diagnostics";

describe("august-command-diagnostics sanitizers", () => {
  it("keeps short identifier-shaped provider values", () => {
    expect(safeDiagnosticToken("locked")).toBe("locked");
    expect(safeDiagnosticToken("unknown_error_during_connect")).toBe(
      "unknown_error_during_connect",
    );
    expect(safeDiagnosticToken(404)).toBe("404");
  });

  it("drops free text, long values and non-strings instead of truncating", () => {
    expect(safeDiagnosticToken("User a@b.com is not authorized")).toBeNull();
    expect(safeDiagnosticToken("x".repeat(65))).toBeNull();
    expect(safeDiagnosticToken("")).toBeNull();
    expect(safeDiagnosticToken({ token: "abc" })).toBeNull();
    expect(safeDiagnosticToken(null)).toBeNull();
  });

  it("re-serializes timestamps and drops anything unparseable", () => {
    expect(safeDiagnosticTimestamp("2026-10-13T12:00:00Z")).toBe(
      "2026-10-13T12:00:00.000Z",
    );
    expect(safeDiagnosticTimestamp("not a date token=abc")).toBeNull();
    expect(safeDiagnosticTimestamp(1760356800000)).toBeNull();
  });

  it("classifies errors coarsely, never by message", () => {
    expect(classifyAugustRequestError(new HttpRequestError("/x", 403))).toBe(
      "http",
    );
    expect(
      classifyAugustRequestError(new DOMException("aborted", "AbortError")),
    ).toBe("timeout");
    expect(classifyAugustRequestError(new TypeError("fetch failed"))).toBe(
      "network",
    );
    expect(classifyAugustRequestError(new Error("anything"))).toBe("other");
    expect(classifyAugustRequestError(undefined)).toBe("other");
  });

  it("a PUT that threw `undefined` is still recorded as a failed acknowledgement", () => {
    expect(buildAckDiagnostics({ error: undefined, elapsedMs: 5 })).toEqual({
      outcome: "no_response",
      httpStatus: null,
      elapsedMs: 5,
      receivedAt: null,
      errorClass: "other",
      providerErrorCode: null,
    });
  });
});
