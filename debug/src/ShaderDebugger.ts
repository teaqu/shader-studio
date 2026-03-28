import { GlslParser } from './GlslParser';
import type { VarInfo } from './GlslParser';
import { CodeGenerator } from './CodeGenerator';
import type { DebugFunctionContext, DebugParameterInfo, DebugLoopInfo } from './types';

/**
 * Orchestrates shader modification for line-by-line debugging.
 * Takes shader code and a debug line, produces modified shader that
 * visualizes the value at that line.
 */
export class ShaderDebugger {
  /**
   * Modifies shader code to execute up to the debug line and visualize the result.
   * Returns modified code or null if modification fails.
   */
  public static modifyShaderForDebugging(
    originalCode: string,
    debugLine: number,
    lineContent: string,
    loopMaxIterations: Map<number, number> = new Map(),
    customParameters: Map<number, string> = new Map(),
    normalizeMode: string = 'off',
    stepEdge: number | null = null,
  ): string | null {
    console.log('[ShaderDebug] === MODIFY SHADER ===');
    console.log('[ShaderDebug] Debug line number:', debugLine);

    const lines = originalCode.split('\n');

    console.log('[ShaderDebug] Cursor line content:', lineContent);
    console.log('[ShaderDebug] Actual shader line:', lines[debugLine] || '<out of bounds>');

    const functionInfo = GlslParser.findEnclosingFunction(lines, debugLine);
    console.log('[ShaderDebug] Function:', functionInfo.name || 'none');

    // If on closing brace of function, treat as last line of body
    if (functionInfo.end >= 0 && debugLine === functionInfo.end) {
      debugLine = functionInfo.end - 1;
      lineContent = lines[debugLine] || '';
      console.log('[ShaderDebug] Resolved closing brace to line:', debugLine);
    }

    if (this.isFunctionEntryLine(lines, debugLine, functionInfo)) {
      if (functionInfo.name === 'mainImage') {
        const lastBodyLine = this.findLastMeaningfulBodyLine(lines, functionInfo);
        if (lastBodyLine >= 0) {
          debugLine = lastBodyLine;
          lineContent = lines[debugLine] || '';
          console.log('[ShaderDebug] Resolved mainImage entry line to body line:', debugLine);
        }
      } else {
        console.log('[ShaderDebug] Function entry line detected; falling back to function result debug');
      }
    }

    const varTypes = GlslParser.buildVariableTypeMap(lines, debugLine, functionInfo);

    // Extract function return type if we're in a function
    let functionReturnType: string | undefined;
    if (functionInfo.name && functionInfo.start >= 0) {
      const funcLine = GlslParser.getFullFunctionSignature(lines, functionInfo.start);
      const returnTypeMatch = funcLine.match(/^\s*([A-Za-z_]\w*)\s+\w+\s*\(/);
      if (returnTypeMatch) {
        functionReturnType = returnTypeMatch[1];
      }
    }

    const actualLineContent = lines[debugLine] || '';
    let varInfo = GlslParser.detectVariableAndType(actualLineContent, varTypes, functionReturnType, lines, debugLine);

    // If we detected a standalone function call, rewrite the line to capture its result
    if (varInfo && varInfo.name === '_dbgCall') {
      const trimmed = actualLineContent.trim().replace(/;$/, '');
      lines[debugLine] = actualLineContent.replace(trimmed, `${varInfo.type} _dbgCall = ${trimmed}`);
      // Update varInfo to use the temp variable with proper name
      varInfo = { name: '_dbgCall', type: varInfo.type };
    }

    if (!varInfo) {
      // Fourth code path: non-mainImage function with no variable → run full function
      if (functionInfo.name && functionInfo.name !== 'mainImage' && functionReturnType && functionReturnType !== 'void') {
        console.log('[ShaderDebug] Path: full function execution (no variable on line)');
        return CodeGenerator.wrapFullFunctionForDebugging(lines, functionInfo, functionReturnType, loopMaxIterations, customParameters, normalizeMode, stepEdge);
      }
      console.log('[ShaderDebug] ❌ Could not detect variable/type');
      return null;
    }
    console.log('[ShaderDebug] ✓ Detected:', varInfo.name, `(${varInfo.type})`);
    console.log('[ShaderDebug] normalizeMode:', normalizeMode);

    let result: string;

    if (functionInfo.name === 'mainImage') {
      console.log('[ShaderDebug] Path: mainImage truncation');
      result = this.truncateMainImage(lines, debugLine, functionInfo.start, varInfo, loopMaxIterations, normalizeMode, stepEdge);
    } else if (functionInfo.name) {
      console.log('[ShaderDebug] Path: helper function wrapper');
      const containingLoops = ShaderDebugger.extractLoops(lines, functionInfo.start, debugLine);
      result = CodeGenerator.wrapFunctionForDebugging(lines, functionInfo, debugLine, varInfo, containingLoops, loopMaxIterations, customParameters, normalizeMode, stepEdge);
    } else {
      console.log('[ShaderDebug] Path: one-liner wrapper');
      result = CodeGenerator.wrapOneLinerForDebugging(actualLineContent, varInfo, normalizeMode, stepEdge);
    }

    console.log('[ShaderDebug] ✅ Success - Modified shader:\n', result);
    return result;
  }

  private static isFunctionEntryLine(lines: string[], lineNumber: number, functionInfo: { start: number; end: number; name: string | null }): boolean {
    if (!functionInfo.name || functionInfo.start < 0) {
      return false;
    }

    if (lineNumber === functionInfo.start) {
      return true;
    }

    for (let i = functionInfo.start + 1; i < functionInfo.end; i++) {
      const trimmed = lines[i]?.replace(/\/\/.*$/, '').trim() ?? '';
      if (trimmed === '') {
        continue;
      }
      return i === lineNumber && trimmed === '{';
    }

    return false;
  }

  private static findLastMeaningfulBodyLine(lines: string[], functionInfo: { start: number; end: number }): number {
    for (let i = functionInfo.end - 1; i > functionInfo.start; i--) {
      const trimmed = lines[i]?.replace(/\/\/.*$/, '').trim() ?? '';
      if (trimmed === '' || trimmed === '{' || trimmed === '}') {
        continue;
      }
      return i;
    }

    return -1;
  }

  /**
   * Extracts function context for the debug panel.
   * Returns info about the enclosing function, its parameters, and loops.
   */
  public static extractFunctionContext(
    originalCode: string,
    debugLine: number,
  ): DebugFunctionContext | null {
    const lines = originalCode.split('\n');
    const functionInfo = GlslParser.findEnclosingFunction(lines, debugLine);

    if (!functionInfo.name || functionInfo.start < 0) {
      return null;
    }

    // Parse return type
    const funcLine = GlslParser.getFullFunctionSignature(lines, functionInfo.start);
    const returnTypeMatch = funcLine.match(/^\s*(void|float|vec2|vec3|vec4|mat2|mat3|mat4|int|bool)\s+\w+\s*\(/);
    const returnType = returnTypeMatch ? returnTypeMatch[1] : 'void';

    // Parse parameters
    const parameters = ShaderDebugger.extractParameters(lines, functionInfo.start);

    // Find loops between function start and debug line
    const loops = ShaderDebugger.extractLoops(lines, functionInfo.start, debugLine);

    return {
      functionName: functionInfo.name,
      returnType,
      parameters,
      isFunction: functionInfo.name !== 'mainImage',
      loops,
    };
  }

  /**
   * Applies normalize/step post-processing to the full shader output.
   * Returns modified code or null if no post-processing is needed.
   */
  public static applyFullShaderPostProcessing(
    originalCode: string,
    normalizeMode: string,
    stepEdge: number | null,
  ): string | null {
    return CodeGenerator.applyOutputPostProcessing(originalCode, normalizeMode, stepEdge);
  }

  private static extractParameters(lines: string[], startLine: number): DebugParameterInfo[] {
    const parameters: DebugParameterInfo[] = [];
    const funcLine = GlslParser.getFullFunctionSignature(lines, startLine);
    const paramsMatch = funcLine.match(/\(([^)]*)\)/);

    if (!paramsMatch || !paramsMatch[1].trim()) {
      return parameters;
    }

    const paramPairs = paramsMatch[1].split(',').map(p => p.trim());

    for (const pair of paramPairs) {
      const match = pair.match(/(?:(in|out|inout)\s+)?(vec2|vec3|vec4|float|int|bool|mat2|mat3|mat4|sampler2D)\s+(\w+)/);
      if (!match) continue;

      const qualifier = match[1];
      // Skip 'out' parameters — they are outputs, not inputs
      if (qualifier === 'out') continue;

      const type = match[2];
      const name = match[3];
      const uvValue = ShaderDebugger.getUvValue(type);
      const defaultCustomValue = ShaderDebugger.getDefaultCustomValue(type);

      const centeredUvValue = ShaderDebugger.getCenteredUvValue(type);

      parameters.push({
        name,
        type,
        uvValue,
        centeredUvValue,
        defaultExpression: type === 'vec2' ? uvValue : defaultCustomValue,
        expression: type === 'vec2' ? uvValue : defaultCustomValue,
      });
    }

    return parameters;
  }

  private static getUvValue(type: string): string {
    switch (type) {
      case 'vec2': return 'uv';
      case 'float': return 'uv.x';
      case 'vec3': return 'vec3(uv, 0.0)';
      case 'vec4': return 'vec4(uv, 0.0, 1.0)';
      case 'int': return 'int(uv.x * 10.0)';
      case 'bool': return 'uv.x > 0.5';
      case 'mat2': return 'mat2(uv.x)';
      case 'mat3': return 'mat3(uv.x)';
      case 'mat4': return 'mat4(uv.x)';
      default: return '';
    }
  }

  /**
   * Returns a self-contained centered UV GLSL expression for the given type.
   * Aspect-ratio-corrected, ranges roughly -1 to 1 in Y, -aspect to aspect in X.
   * Uses fragCoord/iResolution directly (available in the mainImage wrapper scope).
   */
  private static getCenteredUvValue(type: string): string {
    const cuv = '((fragCoord * 2.0 - iResolution.xy) / iResolution.y)';
    switch (type) {
      case 'vec2': return cuv;
      case 'float': return `${cuv}.x`;
      case 'vec3': return `vec3(${cuv}, 0.0)`;
      case 'vec4': return `vec4(${cuv}, 0.0, 1.0)`;
      case 'int': return `int(${cuv}.x * 10.0)`;
      case 'bool': return 'fragCoord.x > iResolution.x * 0.5';
      case 'mat2': return `mat2(${cuv}.x)`;
      case 'mat3': return `mat3(${cuv}.x)`;
      case 'mat4': return `mat4(${cuv}.x)`;
      default: return '';
    }
  }

  private static getDefaultCustomValue(type: string): string {
    switch (type) {
      case 'vec2': return 'vec2(0.5)';
      case 'float': return '0.5';
      case 'vec3': return 'vec3(0.5)';
      case 'vec4': return 'vec4(0.5)';
      case 'int': return '1';
      case 'bool': return 'true';
      case 'mat2': return 'mat2(1.0)';
      case 'mat3': return 'mat3(1.0)';
      case 'mat4': return 'mat4(1.0)';
      case 'sampler2D': return 'iChannel0';
      default: return '0.0';
    }
  }

  /**
   * Finds loops whose body contains the debug line (containing loops).
   * Scans the full function to find loop closing braces, then filters
   * to loops where lineNumber < debugLine < endLine.
   * Returns containing loops ordered outermost-first.
   * loopIndex values are sequential across ALL loops in the function
   * (matching capLoopIterations scan order).
   */
  public static extractLoops(
    lines: string[],
    functionStart: number,
    debugLine: number,
  ): DebugLoopInfo[] {
    // First, find the function's closing brace
    let funcBraceDepth = 0;
    let funcEnd = lines.length - 1;
    let funcBodyStarted = false;
    for (let i = functionStart; i < lines.length; i++) {
      const strippedFuncLine = lines[i].replace(/\/\/.*$/, '');
      for (const char of strippedFuncLine) {
        if (char === '{') { funcBraceDepth++; funcBodyStarted = true; }
        if (char === '}') { funcBraceDepth--; }
      }
      if (funcBodyStarted && funcBraceDepth === 0) {
        funcEnd = i;
        break;
      }
    }

    // Scan full function body to find all loops with their endLines
    interface LoopRecord {
      loopIndex: number;
      lineNumber: number;
      endLine: number;
      loopHeader: string;
      openBraceDepth: number; // braceDepth when the loop's { was opened
    }

    const allLoops: LoopRecord[] = [];
    const loopStack: { index: number; openBraceDepth: number }[] = [];
    let braceDepth = 0;
    let loopIndex = 0;
    // Track pending loops (header seen, waiting for opening brace)
    let pendingLoop: { loopIndex: number; lineNumber: number; loopHeader: string } | null = null;

    for (let i = functionStart + 1; i <= funcEnd; i++) {
      const line = lines[i];
      const forMatch = line.match(/^\s*(for\s*\(.+\))\s*\{?\s*$/);
      const whileMatch = line.match(/^\s*(while\s*\(.+\))\s*\{?\s*$/);
      const loopHeader = forMatch?.[1] || whileMatch?.[1];

      if (loopHeader) {
        const currentLoopIndex = loopIndex++;
        // Check if brace is on the same line (strip comments first)
        if (line.replace(/\/\/.*$/, '').includes('{')) {
          braceDepth++;
          allLoops.push({
            loopIndex: currentLoopIndex,
            lineNumber: i,
            endLine: -1,
            loopHeader,
            openBraceDepth: braceDepth,
          });
          loopStack.push({ index: allLoops.length - 1, openBraceDepth: braceDepth });
        } else {
          // Brace expected on next line
          pendingLoop = { loopIndex: currentLoopIndex, lineNumber: i, loopHeader };
        }
        continue;
      }

      // Process each character for brace tracking (strip // comments first)
      const strippedLine = line.replace(/\/\/.*$/, '');
      for (const char of strippedLine) {
        if (char === '{') {
          braceDepth++;
          if (pendingLoop) {
            allLoops.push({
              loopIndex: pendingLoop.loopIndex,
              lineNumber: pendingLoop.lineNumber,
              endLine: -1,
              loopHeader: pendingLoop.loopHeader,
              openBraceDepth: braceDepth,
            });
            loopStack.push({ index: allLoops.length - 1, openBraceDepth: braceDepth });
            pendingLoop = null;
          }
        }
        if (char === '}') {
          // Check if this closes a loop on the stack
          if (loopStack.length > 0 && loopStack[loopStack.length - 1].openBraceDepth === braceDepth) {
            const entry = loopStack.pop()!;
            allLoops[entry.index].endLine = i;
          }
          braceDepth--;
        }
      }
    }

    // Filter to containing loops: lineNumber < debugLine < endLine
    const containingLoops = allLoops
      .filter(loop => loop.lineNumber < debugLine && loop.endLine > debugLine)
      .map(loop => ({
        loopIndex: loop.loopIndex,
        lineNumber: loop.lineNumber,
        endLine: loop.endLine,
        loopHeader: loop.loopHeader,
        maxIter: null as number | null,
      }));

    // Already outermost-first (they were found in source order, outer loops come first)
    return containingLoops;
  }

  public static truncateMainImage(
    lines: string[],
    debugLine: number,
    functionStart: number,
    varInfo: VarInfo,
    loopMaxIterations: Map<number, number> = new Map(),
    normalizeMode: string = 'off',
    stepEdge: number | null = null,
    captureMode: boolean = false,
  ): string {
    const stripComments = (line: string): string => {
      const commentIndex = line.indexOf('//');
      return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
    };

    // Find containing loops
    const containingLoops = ShaderDebugger.extractLoops(lines, functionStart, debugLine);

    // Determine truncation point
    let truncationEnd: number;
    if (containingLoops.length > 0) {
      // Truncate after the outermost containing loop's closing brace
      const outermostLoop = containingLoops[0];
      truncationEnd = outermostLoop.endLine;
    } else {
      // No containing loops — truncate at the debug line statement end
      truncationEnd = debugLine;
      const debugLineContent = stripComments(lines[debugLine]).trim();
      if (!debugLineContent.endsWith(';') && !debugLineContent.endsWith('{') && !debugLineContent.endsWith('}')) {
        for (let i = debugLine + 1; i < lines.length && i < debugLine + 10; i++) {
          if (stripComments(lines[i]).trim().endsWith(';')) {
            truncationEnd = i;
            break;
          }
        }
      }

      // If the debug line is inside a nested block (if/else/etc.), extend
      // truncationEnd to include all closing braces of those blocks so the
      // output line is inserted AFTER them, not inside.
      let depth = 0;
      for (let i = functionStart; i <= truncationEnd; i++) {
        const stripped = lines[i].replace(/\/\/.*$/, '');
        for (const char of stripped) {
          if (char === '{') depth++;
          if (char === '}') depth--;
        }
      }
      if (depth > 1) {
        // Scan forward until we return to depth 1 (function body level)
        for (let i = truncationEnd + 1; i < lines.length; i++) {
          const stripped = lines[i].replace(/\/\/.*$/, '');
          for (const char of stripped) {
            if (char === '{') depth++;
            if (char === '}') depth--;
          }
          if (depth <= 1) {
            truncationEnd = i;
            break;
          }
        }
      }
    }

    truncationEnd = CodeGenerator.extendForPreprocessorConditionals(lines, functionStart, truncationEnd);

    const truncatedLines = lines.slice(0, truncationEnd + 1);

    // Insert shadow variable if debug line is inside a loop
    const debugLineIndex = debugLine; // index within truncatedLines = same as absolute line number
    const { lines: withShadow, shadowVarName } = CodeGenerator.insertShadowVariable(
      truncatedLines, debugLineIndex, varInfo, containingLoops
    );

    const withCappedLoops = CodeGenerator.capLoopIterations(withShadow, functionStart, loopMaxIterations);
    const closedLines = CodeGenerator.closeOpenBraces(withCappedLoops, functionStart);

    // Insert the debug visualization before the closing braces
    const originalLength = withCappedLoops.length;
    const result = closedLines.slice(0, originalLength);
    const outputVar = shadowVarName || varInfo.name;
    const outputLine = captureMode
      ? CodeGenerator.generateCaptureOutputForVar(varInfo.type, outputVar)
      : CodeGenerator.generateReturnStatementForVar(varInfo.type, outputVar, normalizeMode, stepEdge);
    result.push(outputLine);
    result.push(...closedLines.slice(originalLength));
    return result.join('\n');
  }
}
