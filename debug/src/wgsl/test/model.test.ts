import { describe, expect, it } from "vitest";
import {
  comparePositions,
  containsPosition,
  containsRange,
  offsetAt,
  rangeSize,
} from "../model";

describe("WGSL debug source model", () => {
  it("orders positions by line then character", () => {
    expect(comparePositions({ line: 0, character: 5 }, { line: 0, character: 3 })).toBeGreaterThan(0);
    expect(comparePositions({ line: 1, character: 0 }, { line: 0, character: 99 })).toBeGreaterThan(0);
    expect(comparePositions({ line: 2, character: 1 }, { line: 2, character: 1 })).toBe(0);
  });

  it("tests range containment with inclusive edges", () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } };
    expect(containsPosition(range, { line: 1, character: 2 })).toBe(true);
    expect(containsPosition(range, { line: 3, character: 4 })).toBe(true);
    expect(containsPosition(range, { line: 0, character: 0 })).toBe(false);
    expect(containsRange(range, { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } })).toBe(true);
    expect(containsRange(range, { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } })).toBe(false);
  });

  it("measures range size with lines dominating characters", () => {
    expect(rangeSize({ start: { line: 0, character: 0 }, end: { line: 0, character: 10 } })).toBe(10);
    expect(rangeSize({ start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }))
      .toBeGreaterThan(rangeSize({ start: { line: 0, character: 0 }, end: { line: 0, character: 999 } }));
  });

  it("maps line/character positions to source offsets", () => {
    const source = "ab\ncde\nf";
    expect(offsetAt(source, { line: 0, character: 1 })).toBe(1);
    expect(offsetAt(source, { line: 1, character: 2 })).toBe(5);
    expect(offsetAt(source, { line: 2, character: 1 })).toBe(8);
    expect(offsetAt(source, { line: 9, character: 0 })).toBe(source.length);
  });
});
