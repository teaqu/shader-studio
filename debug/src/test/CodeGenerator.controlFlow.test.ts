import { describe, it, expect } from 'vitest';
import { CodeGenerator } from '../CodeGenerator';

describe('CodeGenerator - Control Flow (closeOpenBraces + capLoopIterations)', () => {
  describe('closeOpenBraces — additional cases', () => {
    it('should handle if inside for inside if (deeply nested)', () => {
      const lines = [
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  if (uv.x > 0.5) {',
        '    for (int i = 0; i < 10; i++) {',
        '      if (float(i) > 5.0) {',
        '        float x = 1.0;',
      ];
      const result = CodeGenerator.closeOpenBraces(lines, 0);
      // 4 unmatched opens: mainImage, if, for, inner if
      expect(result.length).toBe(9);
      expect(result.slice(5)).toEqual(['}', '}', '}', '}']);
    });

    it('should handle braces on separate lines', () => {
      const lines = [
        'void mainImage(out vec4 fragColor, in vec2 fragCoord)',
        '{',
        '  float x = 1.0;',
      ];
      const result = CodeGenerator.closeOpenBraces(lines, 0);
      expect(result.length).toBe(4);
      expect(result[3]).toBe('}');
    });

    it('should handle already-closed inner scopes with open outer', () => {
      const lines = [
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  if (true) {',
        '    float x = 1.0;',
        '  }',
        '  float y = 2.0;',
      ];
      const result = CodeGenerator.closeOpenBraces(lines, 0);
      // if is closed, only mainImage is open
      expect(result.length).toBe(6);
      expect(result[5]).toBe('}');
    });
  });

  describe('capLoopIterations — additional cases', () => {
    it('should handle for-in-if-in-for (if left intact, loops get counters)', () => {
      const lines = [
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  for (int i = 0; i < 10; i++) {',
        '    if (float(i) > 5.0) {',
        '      for (int j = 0; j < 5; j++) {',
        '        float x = 1.0;',
        '      }',
        '    }',
        '  }',
        '}',
      ];
      const result = CodeGenerator.capLoopIterations(lines, 0, new Map([[0, 10], [1, 5]]));
      const joined = result.join('\n');

      // Outer loop capped
      expect(joined).toContain('int _dbgIter0 = 0;');
      expect(joined).toContain('if (++_dbgIter0 > 10) break;');
      // Inner loop capped
      expect(joined).toContain('int _dbgIter1 = 0;');
      expect(joined).toContain('if (++_dbgIter1 > 5) break;');
      // If statement left intact
      expect(joined).toContain('if (float(i) > 5.0) {');
    });

    it('should handle deeply nested for-in-for-in-for with three counters', () => {
      const lines = [
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  for (int i = 0; i < 10; i++) {',
        '    for (int j = 0; j < 5; j++) {',
        '      for (int k = 0; k < 3; k++) {',
        '        float x = 1.0;',
        '      }',
        '    }',
        '  }',
        '}',
      ];
      const result = CodeGenerator.capLoopIterations(lines, 0, new Map([[0, 10], [1, 5], [2, 3]]));
      const joined = result.join('\n');

      expect(joined).toContain('_dbgIter0');
      expect(joined).toContain('_dbgIter1');
      expect(joined).toContain('_dbgIter2');
      expect(joined).toContain('if (++_dbgIter2 > 3) break;');
    });

    it('should place inner counter declaration inside outer body (resets per outer iteration)', () => {
      const lines = [
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  for (int i = 0; i < 10; i++) {',
        '    for (int j = 0; j < 5; j++) {',
        '      float x = 1.0;',
        '    }',
        '  }',
        '}',
      ];
      const result = CodeGenerator.capLoopIterations(lines, 0, new Map([[0, 10], [1, 5]]));

      // Find positions of counter declarations
      const outer = result.findIndex(l => l.includes('int _dbgIter0 = 0;'));
      const inner = result.findIndex(l => l.includes('int _dbgIter1 = 0;'));
      const outerLoop = result.findIndex(l => l.includes('for (int i'));

      // Inner counter appears after outer loop starts (so it's inside the outer body)
      expect(inner).toBeGreaterThan(outerLoop);
      // Outer counter appears before outer loop
      expect(outer).toBeLessThan(outerLoop);
    });

    it('should use custom max from map when provided', () => {
      const lines = [
        'void fn() {',
        '  for (int i = 0; i < 999; i++) {',
        '    float x = 1.0;',
        '  }',
        '}',
      ];
      const result = CodeGenerator.capLoopIterations(lines, 0, new Map([[0, 42]]));
      expect(result.join('\n')).toContain('if (++_dbgIter0 > 42) break;');
    });

    it('should leave loop unmodified when not in map (unlimited by default)', () => {
      const lines = [
        'void fn() {',
        '  for (int i = 0; i < 10; i++) {',
        '    float x = 1.0;',
        '  }',
        '  for (int j = 0; j < 5; j++) {',
        '    float y = 2.0;',
        '  }',
        '}',
      ];
      // Only cap second loop, leave first unlimited
      const result = CodeGenerator.capLoopIterations(lines, 0, new Map([[1, 3]]));
      const joined = result.join('\n');

      expect(joined).not.toContain('_dbgIter0');
      expect(joined).toContain('_dbgIter1');
    });

    it('should keep if/else/while intact (not stripped)', () => {
      const lines = [
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  if (uv.x > 0.5) {',
        '    float x = 1.0;',
        '  } else {',
        '    float x = 0.0;',
        '  }',
        '  while (x > 0.0) {',
        '    x -= 0.1;',
        '  }',
        '}',
      ];
      // Cap the while loop
      const result = CodeGenerator.capLoopIterations(lines, 0, new Map([[0, 50]]));
      const joined = result.join('\n');

      // if/else preserved
      expect(joined).toContain('if (uv.x > 0.5) {');
      expect(joined).toContain('} else {');
      // while gets capped
      expect(joined).toContain('int _dbgIter0 = 0;');
      expect(joined).toContain('if (++_dbgIter0 > 50) break;');
    });
  });
});
