import { describe, it, expect } from 'vitest';
import { CodeGenerator } from '../CodeGenerator';
import type { FunctionInfo, VarInfo } from '../GlslParser';

describe('CodeGenerator - Custom Parameters', () => {
  describe('generateFunctionCall', () => {
    const lines = [
      'float sdf(vec2 p, float r) {',
      '  return length(p) - r;',
      '}',
      'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
      '  vec2 uv = fragCoord / iResolution.xy;',
      '  float d = sdf(uv, 0.5);',
      '  fragColor = vec4(d);',
      '}',
    ];
    const functionInfo: FunctionInfo = { name: 'sdf', start: 0, end: 2 };
    const varInfo: VarInfo = { name: 'result', type: 'float' };

    it('should use default parameters when no custom params provided', () => {
      const result = CodeGenerator.generateFunctionCall(lines, 'sdf', functionInfo, varInfo);
      expect(result).toContain('sdf(uv, 0.5)');
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
    });

    it('should use default parameters when custom params map is empty', () => {
      const result = CodeGenerator.generateFunctionCall(lines, 'sdf', functionInfo, varInfo, new Map());
      expect(result).toContain('sdf(uv, 0.5)');
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
    });

    it('should override specific parameter at given index with custom value', () => {
      const customParams = new Map([[1, '1.0']]);
      const result = CodeGenerator.generateFunctionCall(lines, 'sdf', functionInfo, varInfo, customParams);
      expect(result).toContain('sdf(uv, 1.0)');
      // uv setup still present since first arg still uses uv
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
    });

    it('should remove uv setup line when custom vec2 replaces the default uv', () => {
      const customParams = new Map([[0, 'vec2(0.3, 0.7)']]);
      const result = CodeGenerator.generateFunctionCall(lines, 'sdf', functionInfo, varInfo, customParams);
      expect(result).toContain('sdf(vec2(0.3, 0.7), 0.5)');
      expect(result).not.toContain('vec2 uv = fragCoord / iResolution.xy');
    });

    it('should keep uv setup line when other params still use uv', () => {
      // Function with two vec2 params
      const multiVec2Lines = [
        'float fn(vec2 a, vec2 b) {',
        '  return length(a - b);',
        '}',
      ];
      const multiInfo: FunctionInfo = { name: 'fn', start: 0, end: 2 };
      // Override only the first vec2 param, second still uses uv
      const customParams = new Map([[0, 'vec2(1.0)']]);
      const result = CodeGenerator.generateFunctionCall(multiVec2Lines, 'fn', multiInfo, varInfo, customParams);
      expect(result).toContain('fn(vec2(1.0), uv)');
      // uv setup kept because second arg is still 'uv'
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
    });

    it('should handle overriding only some parameters (mix of default and custom)', () => {
      const multiLines = [
        'float fn(vec2 p, float r, vec3 c) {',
        '  return length(p);',
        '}',
      ];
      const multiInfo: FunctionInfo = { name: 'fn', start: 0, end: 2 };
      // Override only the float param (index 1)
      const customParams = new Map([[1, '2.5']]);
      const result = CodeGenerator.generateFunctionCall(multiLines, 'fn', multiInfo, varInfo, customParams);
      expect(result).toContain('fn(uv, 2.5, vec3(0.5))');
    });

    it('should handle overriding all parameters', () => {
      const customParams = new Map([[0, 'vec2(0.0)'], [1, '3.14']]);
      const result = CodeGenerator.generateFunctionCall(lines, 'sdf', functionInfo, varInfo, customParams);
      expect(result).toContain('sdf(vec2(0.0), 3.14)');
      // No args use 'uv' anymore
      expect(result).not.toContain('vec2 uv = fragCoord / iResolution.xy');
    });
  });

  describe('wrapFunctionForDebugging with custom params', () => {
    it('should pass custom params through to the generated mainImage wrapper call', () => {
      const lines = [
        'float sdf(vec2 p, float r) {',
        '  float d = length(p) - r;',
        '  return d;',
        '}',
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  vec2 uv = fragCoord / iResolution.xy;',
        '  float d = sdf(uv, 0.5);',
        '  fragColor = vec4(vec3(d), 1.0);',
        '}',
      ];
      const functionInfo: FunctionInfo = { name: 'sdf', start: 0, end: 3 };
      const varInfo: VarInfo = { name: 'd', type: 'float' };
      const customParams = new Map([[1, '2.0']]);

      const result = CodeGenerator.wrapFunctionForDebugging(
        lines, functionInfo, 1, varInfo, [], new Map(), customParams
      );

      expect(result).toContain('sdf(uv, 2.0)');
      // uv setup still present since first arg is default 'uv'
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
    });

    it('should remove uv setup when custom param replaces it in wrapper', () => {
      const lines = [
        'float sdf(vec2 p) {',
        '  float d = length(p) - 0.5;',
        '  return d;',
        '}',
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  fragColor = vec4(0.0);',
        '}',
      ];
      const functionInfo: FunctionInfo = { name: 'sdf', start: 0, end: 3 };
      const varInfo: VarInfo = { name: 'd', type: 'float' };
      const customParams = new Map([[0, 'vec2(0.5, 0.5)']]);

      const result = CodeGenerator.wrapFunctionForDebugging(
        lines, functionInfo, 1, varInfo, [], new Map(), customParams
      );

      expect(result).toContain('sdf(vec2(0.5, 0.5))');
      expect(result).not.toContain('vec2 uv = fragCoord / iResolution.xy');
    });
  });

  describe('wrapFunctionForDebugging with loopMaxIterations', () => {
    it('should cap loops in the function body', () => {
      const lines = [
        'float march(vec2 p) {',
        '  float d = 0.0;',
        '  for (int i = 0; i < 100; i++) {',
        '    d += 0.1;',
        '  }',
        '  return d;',
        '}',
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  fragColor = vec4(0.0);',
        '}',
      ];
      const functionInfo: FunctionInfo = { name: 'march', start: 0, end: 6 };
      const varInfo: VarInfo = { name: 'd', type: 'float' };
      const loopMaxIterations = new Map([[0, 10]]);
      // Debug line 3 is inside the loop, so the loop is included as a containing loop
      const containingLoops = [{ lineNumber: 2, endLine: 4 }];

      const result = CodeGenerator.wrapFunctionForDebugging(
        lines, functionInfo, 3, varInfo, containingLoops, loopMaxIterations
      );

      expect(result).toContain('int _dbgIter0 = 0;');
      expect(result).toContain('if (++_dbgIter0 > 10) break;');
    });
  });

  describe('wrapFullFunctionForDebugging', () => {
    it('should wrap the entire function without truncation', () => {
      const lines = [
        'float sdf(vec2 p) {',
        '  float d = length(p) - 0.5;',
        '  d = abs(d);',
        '  return d;',
        '}',
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  fragColor = vec4(0.0);',
        '}',
      ];
      const functionInfo: FunctionInfo = { name: 'sdf', start: 0, end: 4 };

      const result = CodeGenerator.wrapFullFunctionForDebugging(lines, functionInfo, 'float');

      // All function lines present (not truncated)
      expect(result).toContain('float sdf(vec2 p) {');
      expect(result).toContain('float d = length(p) - 0.5;');
      expect(result).toContain('d = abs(d);');
      expect(result).toContain('return d;');
      // Has wrapper mainImage
      expect(result).toContain('void mainImage(out vec4 fragColor, in vec2 fragCoord)');
      expect(result).toContain('sdf(uv)');
      // Visualizes the return value
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    });

    it('should include helper functions before the target function', () => {
      const lines = [
        'float helper(float x) {',
        '  return x * 2.0;',
        '}',
        'float sdf(vec2 p) {',
        '  return helper(length(p));',
        '}',
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  fragColor = vec4(0.0);',
        '}',
      ];
      const functionInfo: FunctionInfo = { name: 'sdf', start: 3, end: 5 };

      const result = CodeGenerator.wrapFullFunctionForDebugging(lines, functionInfo, 'float');

      expect(result).toContain('float helper(float x) {');
      expect(result).toContain('return x * 2.0;');
      expect(result).toContain('float sdf(vec2 p) {');
    });

    it('should use custom parameters in the wrapper call', () => {
      const lines = [
        'float sdf(vec2 p, float r) {',
        '  return length(p) - r;',
        '}',
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  fragColor = vec4(0.0);',
        '}',
      ];
      const functionInfo: FunctionInfo = { name: 'sdf', start: 0, end: 2 };
      const customParams = new Map([[1, '3.0']]);

      const result = CodeGenerator.wrapFullFunctionForDebugging(
        lines, functionInfo, 'float', new Map(), customParams
      );

      expect(result).toContain('sdf(uv, 3.0)');
    });

    it('should cap loops in the full function body', () => {
      const lines = [
        'float march(vec2 p) {',
        '  float d = 0.0;',
        '  for (int i = 0; i < 100; i++) {',
        '    d += 0.1;',
        '  }',
        '  return d;',
        '}',
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
        '  fragColor = vec4(0.0);',
        '}',
      ];
      const functionInfo: FunctionInfo = { name: 'march', start: 0, end: 6 };
      const loopMaxIterations = new Map([[0, 20]]);

      const result = CodeGenerator.wrapFullFunctionForDebugging(
        lines, functionInfo, 'float', loopMaxIterations
      );

      expect(result).toContain('int _dbgIter0 = 0;');
      expect(result).toContain('if (++_dbgIter0 > 20) break;');
      // Full function body preserved
      expect(result).toContain('return d;');
    });

    it('should visualize vec2 return type correctly', () => {
      const lines = [
        'vec2 getUV(vec2 fragCoord) {',
        '  return fragCoord / vec2(800.0, 600.0);',
        '}',
      ];
      const functionInfo: FunctionInfo = { name: 'getUV', start: 0, end: 2 };

      const result = CodeGenerator.wrapFullFunctionForDebugging(lines, functionInfo, 'vec2');

      expect(result).toContain('fragColor = vec4(result, 0.0, 1.0)');
    });

    it('should visualize vec3 return type correctly', () => {
      const lines = [
        'vec3 getColor(vec2 uv) {',
        '  return vec3(uv, 0.5);',
        '}',
      ];
      const functionInfo: FunctionInfo = { name: 'getColor', start: 0, end: 2 };

      const result = CodeGenerator.wrapFullFunctionForDebugging(lines, functionInfo, 'vec3');

      expect(result).toContain('fragColor = vec4(result, 1.0)');
    });
  });
});
