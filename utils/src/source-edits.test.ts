import { describe, expect, it } from "vitest";
import { applySourceEdits } from "./source-edits";

describe("applySourceEdits", () => {
  it("applies unordered non-overlapping edits", () => {
    expect(applySourceEdits("abcdef", [
      { start: 4, end: 6, text: "XY" },
      { start: 1, end: 3, text: "!" },
    ])).toEqual({ ok: true, source: "a!dXY" });
  });

  it("rejects overlapping edits", () => {
    expect(applySourceEdits("abcdef", [
      { start: 1, end: 4, text: "x" },
      { start: 3, end: 5, text: "y" },
    ])).toEqual({ ok: false, code: "debug-overlapping-edits" });
  });

  it("rejects invalid ranges", () => {
    for (const edits of [
      [{ start: 1.5, end: 2, text: "x" }],
      [{ start: 1, end: 2.5, text: "x" }],
      [{ start: -1, end: 2, text: "x" }],
      [{ start: 2, end: 1, text: "x" }],
      [{ start: 0, end: 7, text: "x" }],
    ]) {
      expect(applySourceEdits("abcdef", edits)).toEqual({
        ok: false,
        code: "debug-overlapping-edits",
      });
    }
  });
});
