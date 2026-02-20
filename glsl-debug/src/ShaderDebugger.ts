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
  ): string | null {
    console.log('[ShaderDebug] === MODIFY SHADER ===');
    console.log('[ShaderDebug] Debug line number:', debugLine);

    const lines = originalCode.split('\n');

    console.log('[ShaderDebug] Cursor line content:', lineContent);
    console.log('[ShaderDebug] Actual shader line:', lines[debugLine] || '<out of bounds>');

    const functionInfo = GlslParser.findEnclosingFunction(lines, debugLine);
    console.log('[ShaderDebug] Function:', functionInfo.name || 'none');

    const varTypes = GlslParser.buildVariableTypeMap(lines, debugLine, functionInfo);

    // Extract function return type if we're in a function
    let functionReturnType: string | undefined;
    if (functionInfo.name && functionInfo.start >= 0) {
      const funcLine = lines[functionInfo.start];
      const returnTypeMatch = funcLine.match(/^\s*(void|float|vec2|vec3|vec4|mat2|mat3|mat4)\s+\w+\s*\(/);
      if (returnTypeMatch) {
        functionReturnType = returnTypeMatch[1];
      }
    }

    const actualLineContent = lines[debugLine] || '';
    const varInfo = GlslParser.detectVariableAndType(actualLineContent, varTypes, functionReturnType, lines, debugLine);
    if (!varInfo) {
      console.log('[ShaderDebug] ❌ Could not detect variable/type');
      return null;
    }
    console.log('[ShaderDebug] ✓ Detected:', varInfo.name, `(${varInfo.type})`);

    let result: string;

    if (functionInfo.name === 'mainImage') {
      console.log('[ShaderDebug] Path: mainImage truncation');
      result = this.truncateMainImage(lines, debugLine, functionInfo.start, varInfo, loopMaxIterations);
    } else if (functionInfo.name) {
      console.log('[ShaderDebug] Path: helper function wrapper');
      const containingLoops = ShaderDebugger.extractLoops(lines, functionInfo.start, debugLine);
      result = CodeGenerator.wrapFunctionForDebugging(lines, functionInfo, debugLine, varInfo, containingLoops, loopMaxIterations);
    } else {
      console.log('[ShaderDebug] Path: one-liner wrapper');
      result = CodeGenerator.wrapOneLinerForDebugging(lineContent, varInfo);
    }

    console.log('[ShaderDebug] ✅ Success - Modified shader:\n', result);
    return result;
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
    const funcLine = lines[functionInfo.start];
    const returnTypeMatch = funcLine.match(/^\s*(void|float|vec2|vec3|vec4|mat2|mat3|mat4|int|bool)\s+\w+\s*\(/);
    const returnType = returnTypeMatch ? returnTypeMatch[1] : 'void';

    // Parse parameters
    const parameters = ShaderDebugger.extractParameters(funcLine);

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

  private static extractParameters(funcLine: string): DebugParameterInfo[] {
    const parameters: DebugParameterInfo[] = [];
    const paramsMatch = funcLine.match(/\(([^)]*)\)/);

    if (!paramsMatch || !paramsMatch[1].trim()) {
      return parameters;
    }

    const paramPairs = paramsMatch[1].split(',').map(p => p.trim());

    for (const pair of paramPairs) {
      const match = pair.match(/(?:in|out|inout)?\s*(vec2|vec3|vec4|float|int|bool|mat2|mat3|mat4|sampler2D)\s+(\w+)/);
      if (!match) continue;

      const type = match[1];
      const name = match[2];
      const uvValue = ShaderDebugger.getUvValue(type);
      const defaultCustomValue = ShaderDebugger.getDefaultCustomValue(type);

      parameters.push({
        name,
        type,
        uvValue,
        defaultCustomValue,
        mode: type === 'vec2' ? 'uv' : 'custom',
        customValue: defaultCustomValue,
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
  private static extractLoops(
    lines: string[],
    functionStart: number,
    debugLine: number,
  ): DebugLoopInfo[] {
    // First, find the function's closing brace
    let funcBraceDepth = 0;
    let funcEnd = lines.length - 1;
    let funcBodyStarted = false;
    for (let i = functionStart; i < lines.length; i++) {
      for (const char of lines[i]) {
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
        // Check if brace is on the same line
        if (line.includes('{')) {
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

      // Process each character for brace tracking
      for (const char of line) {
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

  private static truncateMainImage(
    lines: string[],
    debugLine: number,
    functionStart: number,
    varInfo: VarInfo,
    loopMaxIterations: Map<number, number> = new Map(),
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
    }

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
    result.push(CodeGenerator.generateReturnStatementForVar(varInfo.type, outputVar));
    result.push(...closedLines.slice(originalLength));
    return result.join('\n');
  }
}
