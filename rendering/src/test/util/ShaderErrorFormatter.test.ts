import { describe, expect, it, vi } from "vitest";
import { ShaderErrorFormatter } from "../../util/ShaderErrorFormatter";
import type { PiRenderer } from "../../types/piRenderer";

describe("ShaderErrorFormatter", () => {
  const createMockRenderer = (headerLines: number = 6): PiRenderer => ({
    GetShaderHeaderLines: vi.fn().mockReturnValue(headerLines),
  } as unknown as PiRenderer);

  describe("formatShaderError", () => {
    it("should adjust line numbers based on header lines", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: 'vedc2' : no matching overloaded function found";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("ERROR: 0:4: 'vedc2' : no matching overloaded function found");
      expect(result[0].line).toBe(4);
      expect(result[0].isCommonBufferError).toBe(false);
    });

    it("should handle multiple errors in one string", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: first error\nERROR: 0:25: second error";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(2);
      expect(result[0].message).toContain("ERROR: 0:4:");
      expect(result[0].line).toBe(4);
      expect(result[1].message).toContain("ERROR: 0:9:");
      expect(result[1].line).toBe(9);
    });

    it("should handle multiple errors on a single line (no newline separator)", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: first error ERROR: 0:25: second error";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(2);
      expect(result[0].message).toContain("ERROR: 0:4:");
      expect(result[0].line).toBe(4);
      expect(result[1].message).toContain("ERROR: 0:9:");
      expect(result[1].line).toBe(9);
    });

    it("should not produce negative line numbers", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:5: error on early line";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("ERROR: 0:1: error on early line");
      expect(result[0].line).toBe(1);
    });

    it("should remove NUL characters", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20:\x00 syntax error";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(1);
      expect(result[0].message).not.toContain("\x00");
      expect(result[0].message).toBe("ERROR: 0:4: syntax error");
    });

    it("should remove control characters", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20:\x01\x02\x03 bad chars";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("ERROR: 0:4: bad chars");
    });

    it("should normalize Windows line endings", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: first\r\nERROR: 0:21: second";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(2);
      expect(result[0].message).not.toContain("\r\n");
    });

    it("should collapse multiple newlines", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: first\n\n\nERROR: 0:21: second";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(2);
      expect(result[0].message).toBe("ERROR: 0:4: first");
      expect(result[1].message).toBe("ERROR: 0:5: second");
    });

    it("should trim whitespace", () => {
      const renderer = createMockRenderer(6);
      const error = "  ERROR: 0:20: error  \n  ";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("ERROR: 0:4: error");
    });

    it("should handle complex GPU driver output", () => {
      const renderer = createMockRenderer(6);
      const error = "\x00ERROR: 0:20: 'vedc2' : no matching\r\n\r\nERROR: 0:20: '=' : dimension mismatch\x00\n\n";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(2);
      expect(result[0].message).toBe("ERROR: 0:4: 'vedc2' : no matching");
      expect(result[1].message).toBe("ERROR: 0:4: '=' : dimension mismatch");
    });

    it("should preserve tabs in error messages", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20:\terror with tab";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(1);
      expect(result[0].message).toContain("\t");
    });

    it("should attach non-ERROR continuation lines to previous error", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: syntax error\n  additional context line";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("ERROR: 0:4: syntax error\n  additional context line");
    });

    it("should handle three or more errors on a single line", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: first ERROR: 0:21: second ERROR: 0:22: third";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(3);
      expect(result[0].message).toBe("ERROR: 0:4: first");
      expect(result[0].line).toBe(4);
      expect(result[1].message).toBe("ERROR: 0:5: second");
      expect(result[1].line).toBe(5);
      expect(result[2].message).toBe("ERROR: 0:6: third");
      expect(result[2].line).toBe(6);
    });

    it("should return empty array for empty string", () => {
      const renderer = createMockRenderer(6);
      const result = ShaderErrorFormatter.formatShaderError("", renderer, 10);

      expect(result).toHaveLength(0);
    });

    it("should return empty array for string with no ERROR pattern", () => {
      const renderer = createMockRenderer(6);
      const result = ShaderErrorFormatter.formatShaderError("some random text", renderer, 10);

      expect(result).toHaveLength(0);
    });

    it("should discard garbage text before first ERROR on a line", () => {
      const renderer = createMockRenderer(6);
      const error = "WARNING: garbage stuff ERROR: 0:20: actual error";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("ERROR: 0:4: actual error");
      expect(result[0].line).toBe(4);
    });

    it("should attach continuation lines to correct error after single-line split", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: first ERROR: 0:25: second\n  continuation of second error";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(2);
      expect(result[0].message).toBe("ERROR: 0:4: first");
      expect(result[1].message).toBe("ERROR: 0:9: second\n  continuation of second error");
    });

    it("should discard leading non-ERROR lines with no prior error", () => {
      const renderer = createMockRenderer(6);
      const error = "some preamble text\nERROR: 0:20: the real error";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("ERROR: 0:4: the real error");
    });

    it("should handle whitespace-only input", () => {
      const renderer = createMockRenderer(6);
      const result = ShaderErrorFormatter.formatShaderError("   \n  \n  ", renderer, 10);

      expect(result).toHaveLength(0);
    });
  });

  describe("common buffer error detection", () => {
    it("should detect error in common buffer code", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:25: syntax error in common";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 22, 5);

      expect(result).toHaveLength(1);
      expect(result[0].isCommonBufferError).toBe(true);
      expect(result[0].message).toBe("ERROR: 0:2: syntax error in common");
      expect(result[0].line).toBe(2);
    });

    it("should not flag pass code errors as common buffer errors", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:30: syntax error in pass";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 22, 5);

      expect(result).toHaveLength(1);
      expect(result[0].isCommonBufferError).toBe(false);
      expect(result[0].message).toBe("ERROR: 0:2: syntax error in pass");
    });

    it("should handle error on first line of common buffer", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:24: error on first common line";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 22, 5);

      expect(result).toHaveLength(1);
      expect(result[0].isCommonBufferError).toBe(true);
      expect(result[0].message).toBe("ERROR: 0:1: error on first common line");
    });

    it("should handle error on last line of common buffer", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:28: error on last common line";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 22, 5);

      expect(result).toHaveLength(1);
      expect(result[0].isCommonBufferError).toBe(true);
      expect(result[0].message).toBe("ERROR: 0:5: error on last common line");
    });

    it("should not flag as common when no common code exists", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: regular error";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 17, 0);

      expect(result).toHaveLength(1);
      expect(result[0].isCommonBufferError).toBe(false);
      expect(result[0].message).toBe("ERROR: 0:1: regular error");
    });

    it("should handle error on boundary between uniform header and common code", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:23: error at boundary";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 22, 5);

      expect(result).toHaveLength(1);
      expect(result[0].isCommonBufferError).toBe(false);
    });

    it("should handle mixed common and pass errors in one string", () => {
      // renderer: 6, uniform: 17, common: 5, headerLineCount: 22
      // common starts at 23, ends at 28
      // pass code starts after 6 + 22 = 28
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:25: error in common buffer\nERROR: 0:30: error in pass code";

      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 22, 5);

      expect(result).toHaveLength(2);
      expect(result[0].isCommonBufferError).toBe(true);
      expect(result[0].message).toBe("ERROR: 0:2: error in common buffer");
      expect(result[0].line).toBe(2);
      expect(result[1].isCommonBufferError).toBe(false);
      expect(result[1].message).toBe("ERROR: 0:2: error in pass code");
      expect(result[1].line).toBe(2);
    });
  });
});
