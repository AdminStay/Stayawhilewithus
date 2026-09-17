import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses simple comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("parses a quoted field containing a literal comma — the exact shape the real sheet's own date cells use", () => {
    expect(parseCsv('x,"March 5,2025",y\n')).toEqual([
      ["x", "March 5,2025", "y"],
    ]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(parseCsv('"Henry ""the MOD""",b\n')).toEqual([
      ['Henry "the MOD"', "b"],
    ]);
  });

  it("handles a trailing row with no final newline", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles empty fields (consecutive commas) without dropping them", () => {
    expect(parseCsv("a,,c\n")).toEqual([["a", "", "c"]]);
  });

  it("handles CRLF line endings the same as bare LF", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});
