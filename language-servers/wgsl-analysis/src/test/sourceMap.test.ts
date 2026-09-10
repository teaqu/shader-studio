import { describe, expect, it } from "vitest";
import {
  assembledLineToUserLine,
  buildWgslAssembledMapping,
  userLineToAssembledLine,
} from "../sourceMap";

describe("wgsl assembled-module source map", () => {
  it("round-trips user lines through the prelude offset", () => {
    const mapping = buildWgslAssembledMapping(42, 10);

    for (let userLine = 1; userLine <= 10; userLine++) {
      expect(assembledLineToUserLine(mapping, userLineToAssembledLine(mapping, userLine))).toBe(userLine);
    }
  });

  it("maps assembled diagnostics back onto user lines", () => {
    const mapping = buildWgslAssembledMapping(42, 10);

    expect(assembledLineToUserLine(mapping, 43)).toBe(1);
    expect(assembledLineToUserLine(mapping, 52)).toBe(10);
  });

  it("clamps prelude and out-of-range lines instead of escaping the document", () => {
    const mapping = buildWgslAssembledMapping(42, 10);

    expect(assembledLineToUserLine(mapping, 7)).toBe(1);
    expect(assembledLineToUserLine(mapping, 1000)).toBe(10);
    expect(userLineToAssembledLine(mapping, 1)).toBe(43);
  });

  it("is a no-op without a prelude", () => {
    const mapping = buildWgslAssembledMapping(0, 4);

    expect(assembledLineToUserLine(mapping, 3)).toBe(3);
    expect(userLineToAssembledLine(mapping, 3)).toBe(3);
  });
});
