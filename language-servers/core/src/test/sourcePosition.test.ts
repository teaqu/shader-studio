import { describe, expect, it } from "vitest";
import { isPositionInComment } from "../sourcePosition";

describe("isPositionInComment", () => {
  it("recognizes line, block, and nested block comments", () => {
    const source = `// documentedWord
/* documentedWord */
/* outer /* nested */ documentedWord */`;

    expect(isPositionInComment(source, { line: 0, character: 5 })).toBe(true);
    expect(isPositionInComment(source, { line: 1, character: 5 })).toBe(true);
    expect(isPositionInComment(source, { line: 2, character: 24 })).toBe(true);
  });

  it("does not treat comment markers inside quoted strings as comments", () => {
    const source = `const char* marker = "//"; documentedWord
const char* block = "/* still a string */"; documentedWord`;

    expect(isPositionInComment(source, { line: 0, character: 30 })).toBe(false);
    expect(isPositionInComment(source, { line: 1, character: 48 })).toBe(false);
  });
});
