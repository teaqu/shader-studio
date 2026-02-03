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
      
      expect(result).toBe("ERROR: 0:4: 'vedc2' : no matching overloaded function found");
    });

    it("should handle multiple errors in one string", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: first error\nERROR: 0:25: second error";
      
      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);
      
      expect(result).toContain("ERROR: 0:4:");
      expect(result).toContain("ERROR: 0:9:");
    });

    it("should not produce negative line numbers", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:5: error on early line";
      
      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);
      
      expect(result).toBe("ERROR: 0:1: error on early line");
    });

    it("should remove NUL characters", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20:\x00 syntax error";
      
      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);
      
      expect(result).not.toContain("\x00");
      expect(result).toBe("ERROR: 0:4: syntax error");
    });

    it("should remove control characters", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20:\x01\x02\x03 bad chars";
      
      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);
      
      expect(result).toBe("ERROR: 0:4: bad chars");
    });

    it("should normalize Windows line endings", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: first\r\nERROR: 0:21: second";
      
      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);
      
      expect(result).not.toContain("\r\n");
      expect(result).toContain("\n");
    });

    it("should collapse multiple newlines", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20: first\n\n\nERROR: 0:21: second";
      
      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);
      
      expect(result).toBe("ERROR: 0:4: first\nERROR: 0:5: second");
    });

    it("should trim whitespace", () => {
      const renderer = createMockRenderer(6);
      const error = "  ERROR: 0:20: error  \n  ";
      
      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);
      
      expect(result).toBe("ERROR: 0:4: error");
    });

    it("should handle complex GPU driver output", () => {
      const renderer = createMockRenderer(6);
      const error = "\x00ERROR: 0:20: 'vedc2' : no matching\r\n\r\nERROR: 0:20: '=' : dimension mismatch\x00\n\n";
      
      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);
      
      expect(result).toBe("ERROR: 0:4: 'vedc2' : no matching\nERROR: 0:4: '=' : dimension mismatch");
    });

    it("should preserve tabs in error messages", () => {
      const renderer = createMockRenderer(6);
      const error = "ERROR: 0:20:\terror with tab";
      
      const result = ShaderErrorFormatter.formatShaderError(error, renderer, 10);
      
      expect(result).toContain("\t");
    });
  });
});
