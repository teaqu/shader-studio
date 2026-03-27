import { GlslParser } from './GlslParser';
import type { FunctionInfo, VarInfo } from './GlslParser';

export class CodeGenerator {
  private static defaultParameterValue(type: string): string {
    switch (type) {
      case 'vec2': return 'uv';
      case 'vec3': return 'vec3(0.5)';
      case 'vec4': return 'vec4(0.5)';
      case 'float': return '0.5';
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
   * Soft normalization: v / (|v| + 1) * 0.5 + 0.5
   * Maps any range to 0-1: negative → below 0.5, positive → above 0.5, zero → 0.5 (gray).
   */
  private static softNormExpr(expr: string): string {
    return `(${expr} / (abs(${expr}) + 1.0) * 0.5 + 0.5)`;
  }

  /**
   * Abs normalization: abs(v) / (abs(v) + 1.0)
   * Maps magnitude to 0-1: zero → 0 (black), large values → 1 (white).
   */
  private static absNormExpr(expr: string): string {
    return `(abs(${expr}) / (abs(${expr}) + 1.0))`;
  }

  static generateReturnStatementForVar(varType: string, varName: string, normalizeMode: string = 'off', stepEdge: number | null = null): string {
    let line: string;

    if (normalizeMode === 'soft') {
      switch (varType) {
        case 'float': {
          const n = CodeGenerator.softNormExpr(varName);
          line = `  fragColor = vec4(vec3(${n}), 1.0); // Debug: soft normalized float`;
          break;
        }
        case 'vec2': {
          const n = `(${varName} / (abs(${varName}) + vec2(1.0)) * 0.5 + 0.5)`;
          line = `  fragColor = vec4(${n}, 0.0, 1.0); // Debug: soft normalized vec2`;
          break;
        }
        case 'vec3': {
          const n = `(${varName} / (abs(${varName}) + vec3(1.0)) * 0.5 + 0.5)`;
          line = `  fragColor = vec4(${n}, 1.0); // Debug: soft normalized vec3`;
          break;
        }
        case 'vec4': {
          const rgb = `(${varName}.rgb / (abs(${varName}.rgb) + vec3(1.0)) * 0.5 + 0.5)`;
          line = `  fragColor = vec4(${rgb}, 1.0); // Debug: soft normalized vec4`;
          break;
        }
        default:
          line = CodeGenerator.generateReturnStatementForVar(varType, varName, 'off');
      }
    } else if (normalizeMode === 'abs') {
      switch (varType) {
        case 'float': {
          const n = CodeGenerator.absNormExpr(varName);
          line = `  fragColor = vec4(vec3(${n}), 1.0); // Debug: abs normalized float`;
          break;
        }
        case 'vec2': {
          const n = `(abs(${varName}) / (abs(${varName}) + vec2(1.0)))`;
          line = `  fragColor = vec4(${n}, 0.0, 1.0); // Debug: abs normalized vec2`;
          break;
        }
        case 'vec3': {
          const n = `(abs(${varName}) / (abs(${varName}) + vec3(1.0)))`;
          line = `  fragColor = vec4(${n}, 1.0); // Debug: abs normalized vec3`;
          break;
        }
        case 'vec4': {
          const rgb = `(abs(${varName}.rgb) / (abs(${varName}.rgb) + vec3(1.0)))`;
          line = `  fragColor = vec4(${rgb}, 1.0); // Debug: abs normalized vec4`;
          break;
        }
        default:
          line = CodeGenerator.generateReturnStatementForVar(varType, varName, 'off');
      }
    } else {
      switch (varType) {
        case 'float':
          line = `  fragColor = vec4(vec3(${varName}), 1.0); // Debug: visualize float as grayscale`;
          break;
        case 'vec2':
          line = `  fragColor = vec4(${varName}, 0.0, 1.0); // Debug: visualize vec2 (RG channels)`;
          break;
        case 'vec3':
          line = `  fragColor = vec4(${varName}, 1.0); // Debug: visualize vec3 as RGB`;
          break;
        case 'vec4':
          line = `  fragColor = ${varName}; // Debug: visualize vec4 directly`;
          break;
        case 'mat2':
          line = `  fragColor = vec4(${varName}[0], ${varName}[1]); // Debug: visualize mat2 as vec4`;
          break;
        case 'mat3':
          line = `  fragColor = vec4(${varName}[0], 1.0); // Debug: visualize mat3 first row`;
          break;
        case 'mat4':
          line = `  fragColor = ${varName}[0]; // Debug: visualize mat4 first row`;
          break;
        default:
          line = '  fragColor = vec4(1.0, 0.0, 1.0, 1.0); // Debug: unknown type';
      }
    }

    // Step post-processing: apply binary threshold to the visualization
    if (stepEdge !== null) {
      const edge = stepEdge.toFixed(4);
      line += `\n  fragColor = vec4(step(vec3(${edge}), fragColor.rgb), 1.0); // Debug: step threshold`;
    }

    return line;
  }

  /**
   * Generates a fragColor assignment for capture mode (raw float output, no normalization).
   * Used by VariableCaptureBuilder for off-canvas float FBO capture.
   */
  static generateCaptureOutputForVar(varType: string, varName: string): string {
    switch (varType) {
      case 'float':
        return `  fragColor = vec4(${varName}, 0.0, 0.0, 0.0);`;
      case 'vec2':
        return `  fragColor = vec4(${varName}, 0.0, 0.0);`;
      case 'vec3':
        return `  fragColor = vec4(${varName}, 0.0);`;
      case 'vec4':
        return `  fragColor = ${varName};`;
      case 'int':
        return `  fragColor = vec4(float(${varName}), 0.0, 0.0, 0.0);`;
      case 'bool':
        return `  fragColor = vec4(${varName} ? 1.0 : 0.0, 0.0, 0.0, 0.0);`;
      case 'mat2':
        return `  fragColor = vec4(${varName}[0], ${varName}[1]);`;
      default:
        return `  fragColor = vec4(0.0);`;
    }
  }

  /**
   * Counts unmatched opening braces after functionStart and appends
   * the right number of closing braces. Keeps all lines intact.
   */
  static closeOpenBraces(lines: string[], functionStart: number): string[] {
    const result = [...lines];
    let braceDepth = 0;

    for (let i = functionStart; i < lines.length; i++) {
      const stripped = lines[i].replace(/\/\/.*$/, '');
      for (const char of stripped) {
        if (char === '{') braceDepth++;
        if (char === '}') braceDepth--;
      }
    }

    // Append closing braces to balance
    for (let i = 0; i < braceDepth; i++) {
      result.push('}');
    }

    return result;
  }

  /**
   * Finds for/while loops after functionStart and injects iteration capping.
   * Only injects capping code for loops in the loopMaxIterations map.
   * Loops not in the map are left unmodified (unlimited).
   */
  static capLoopIterations(
    lines: string[],
    functionStart: number,
    loopMaxIterations: Map<number, number>,
  ): string[] {
    if (loopMaxIterations.size === 0) {
      return [...lines];
    }

    const result: string[] = [];
    let loopIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (i > functionStart) {
        const isForLoop = /^\s*for\s*\(/.test(line);
        const isWhileLoop = /^\s*while\s*\(/.test(line);

        if (isForLoop || isWhileLoop) {
          const maxIter = loopMaxIterations.get(loopIndex);

          if (maxIter !== undefined) {
            const indent = line.match(/^(\s*)/)?.[1] || '';
            const bodyIndent = indent + '  ';

            // Insert counter declaration before the loop
            result.push(`${indent}int _dbgIter${loopIndex} = 0;`);
            result.push(line);

            // Find the opening brace (same line or next)
            const hasBraceOnSameLine = line.includes('{');
            if (!hasBraceOnSameLine) {
              // Look for brace on next line
              if (i + 1 < lines.length && lines[i + 1].trim() === '{') {
                i++;
                result.push(lines[i]);
              }
            }

            // Insert break condition as first statement in loop body
            result.push(`${bodyIndent}if (++_dbgIter${loopIndex} > ${maxIter}) break;`);
          } else {
            result.push(line);
          }

          loopIndex++;
          continue;
        }
      }

      result.push(line);
    }

    return result;
  }

  /**
   * Inserts a shadow variable when the debug line is inside a containing loop.
   * Declares `{type} _dbgShadow;` before the outermost containing loop,
   * and inserts `_dbgShadow = {varName};` after the debug line.
   * Returns the modified lines and the shadow variable name (or null if no shadow needed).
   */
  static insertShadowVariable(
    lines: string[],
    debugLineIndex: number,
    varInfo: VarInfo,
    containingLoops: { lineNumber: number }[],
  ): { lines: string[]; shadowVarName: string | null } {
    if (containingLoops.length === 0) {
      return { lines: [...lines], shadowVarName: null };
    }

    const shadowVarName = '_dbgShadow';
    const result: string[] = [];

    // Find the outermost loop line index within the provided lines array.
    // The lineNumber in containingLoops is an absolute line number from the original source,
    // but we need to find it within the given lines array.
    let outermostLoopIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      // Match by content — find the loop header line
      const line = lines[i];
      const isForLoop = /^\s*for\s*\(/.test(line);
      const isWhileLoop = /^\s*while\s*\(/.test(line);
      if ((isForLoop || isWhileLoop) && i <= debugLineIndex) {
        // Check if this is the outermost loop by checking if it's at the right position
        // We scan from the start, and the first loop we find at or before the debug line
        // that matches should be the outermost
        if (outermostLoopIndex === -1) {
          outermostLoopIndex = i;
        }
      }
    }

    if (outermostLoopIndex === -1) {
      return { lines: [...lines], shadowVarName: null };
    }

    const indent = lines[outermostLoopIndex].match(/^(\s*)/)?.[1] || '  ';
    const debugIndent = lines[debugLineIndex]?.match(/^(\s*)/)?.[1] || '    ';

    for (let i = 0; i < lines.length; i++) {
      if (i === outermostLoopIndex) {
        result.push(`${indent}${varInfo.type} ${shadowVarName};`);
      }
      result.push(lines[i]);
      if (i === debugLineIndex) {
        result.push(`${debugIndent}${shadowVarName} = ${varInfo.name};`);
      }
    }

    return { lines: result, shadowVarName };
  }

  static generateDefaultParameters(
    lines: string[],
    functionInfo: FunctionInfo
  ): { args: string; setup: string[] } {
    const setup: string[] = [];
    const args: string[] = [];

    const signature = GlslParser.getFullFunctionSignature(lines, functionInfo.start);
    const paramsMatch = signature.match(/\(([^)]*)\)/s);

    if (!paramsMatch || !paramsMatch[1].trim()) {
      return { args: '', setup: [] };
    }

    const paramsStr = paramsMatch[1];
    const paramPairs = paramsStr.split(',').map(p => p.trim());

    for (const pair of paramPairs) {
      const match = pair.match(/^\s*(?:(in|out|inout)\s+)?(vec2|vec3|vec4|float|int|bool|mat2|mat3|mat4|sampler2D)\s+(\w+)\s*$/);

      if (match) {
        const qualifier = match[1];
        const type = match[2];
        const defaultValue = CodeGenerator.defaultParameterValue(type);

        switch (type) {
          case 'vec2':
            if (!setup.some(s => s.includes('vec2 uv'))) {
              setup.push('  vec2 uv = fragCoord / iResolution.xy;');
            }
            if (qualifier === 'out' || qualifier === 'inout') {
              const tempName = `_dbgArg${args.length}`;
              setup.push(`  ${type} ${tempName} = ${defaultValue};`);
              args.push(tempName);
            } else {
              args.push(defaultValue);
            }
            break;
          default: {
            if (qualifier === 'out' || qualifier === 'inout') {
              const tempName = `_dbgArg${args.length}`;
              setup.push(`  ${type} ${tempName} = ${defaultValue};`);
              args.push(tempName);
            } else {
              args.push(defaultValue);
            }
          }
        }
      }
    }

    return {
      args: args.join(', '),
      setup
    };
  }

  static generateFunctionCall(
    lines: string[],
    functionName: string,
    functionInfo: FunctionInfo,
    varInfo: VarInfo,
    customParameters: Map<number, string> = new Map(),
    normalizeMode: string = 'off',
    stepEdge: number | null = null,
  ): string {
    const params = CodeGenerator.generateDefaultParameters(lines, functionInfo);
    const defaultArgs = params.args ? params.args.split(', ') : [];

    // Apply custom parameter overrides
    const args = defaultArgs.map((arg, index) => {
      const custom = customParameters.get(index);
      return custom !== undefined ? custom : arg;
    });

    // If no args still reference 'uv', remove the uv setup line
    let setup = [...params.setup];
    const anyArgUsesUv = args.some(arg => arg === 'uv' || arg.includes('uv'));
    if (!anyArgUsesUv) {
      setup = setup.filter(s => !s.includes('vec2 uv'));
    }

    const visualization = CodeGenerator.generateReturnStatementForVar(varInfo.type, 'result', normalizeMode, stepEdge);
    const setupCode = setup.length > 0 ? setup.join('\n') + '\n' : '';
    return `${setupCode}  ${varInfo.type} result = ${functionName}(${args.join(', ')});\n${visualization}`;
  }

  static generateProcedureCall(
    lines: string[],
    functionName: string,
    functionInfo: FunctionInfo,
    targetVarName: string,
    targetVarType: string,
    customParameters: Map<number, string> = new Map(),
    normalizeMode: string = 'off',
    stepEdge: number | null = null,
  ): string {
    const params = CodeGenerator.generateDefaultParameters(lines, functionInfo);
    const defaultArgs = params.args ? params.args.split(', ') : [];

    const args = defaultArgs.map((arg, index) => {
      const custom = customParameters.get(index);
      return custom !== undefined ? custom : arg;
    });

    let setup = [...params.setup];
    const anyArgUsesUv = args.some(arg => arg === 'uv' || arg.includes('uv'));
    if (!anyArgUsesUv) {
      setup = setup.filter(s => !s.includes('vec2 uv'));
    }

    const visualization = CodeGenerator.generateReturnStatementForVar(targetVarType, targetVarName, normalizeMode, stepEdge);
    const setupCode = setup.length > 0 ? setup.join('\n') + '\n' : '';
    return `${setupCode}  ${functionName}(${args.join(', ')});\n${visualization}`;
  }

  /**
   * Extends a truncation end line to include the full multi-line statement.
   * If the line doesn't end with ; { or }, scans forward to find the statement end.
   */
  static extendForMultiLine(lines: string[], truncationEnd: number): number {
    const stripComments = (line: string): string => {
      const commentIndex = line.indexOf('//');
      return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
    };
    const content = stripComments(lines[truncationEnd] || '').trim();
    if (content.length > 0 && !content.endsWith(';') && !content.endsWith('{') && !content.endsWith('}')) {
      for (let i = truncationEnd + 1; i < lines.length && i < truncationEnd + 20; i++) {
        if (stripComments(lines[i]).trim().endsWith(';')) {
          return i;
        }
      }
    }
    return truncationEnd;
  }

  /**
   * Extends truncation to keep preprocessor conditionals structurally balanced.
   * This prevents wrappers from cutting inside `#if/#else/#endif` blocks.
   */
  static extendForPreprocessorConditionals(
    lines: string[],
    startLine: number,
    truncationEnd: number,
  ): number {
    let conditionalDepth = 0;

    for (let i = startLine; i <= truncationEnd; i++) {
      const trimmed = (lines[i] || '').trim();
      if (/^#\s*(if|ifdef|ifndef)\b/.test(trimmed)) {
        conditionalDepth++;
      } else if (/^#\s*endif\b/.test(trimmed)) {
        conditionalDepth = Math.max(0, conditionalDepth - 1);
      }
    }

    if (conditionalDepth === 0) {
      return truncationEnd;
    }

    for (let i = truncationEnd + 1; i < lines.length; i++) {
      const trimmed = (lines[i] || '').trim();
      if (/^#\s*(if|ifdef|ifndef)\b/.test(trimmed)) {
        conditionalDepth++;
      } else if (/^#\s*endif\b/.test(trimmed)) {
        conditionalDepth--;
        if (conditionalDepth === 0) {
          return i;
        }
      }
    }

    return truncationEnd;
  }

  /**
   * Finds the range of a return statement that contains the debug line.
   * Scans backward from debugLine to find `return`, forward to find `;`.
   * Returns null if the debug line is not part of a return statement.
   */
  static findReturnRange(
    lines: string[],
    debugLine: number,
    truncationEnd: number,
  ): { start: number; end: number } | null {
    const stripComments = (line: string): string => {
      const commentIndex = line.indexOf('//');
      return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
    };

    // Check if the debug line itself starts with return
    const debugContent = stripComments(lines[debugLine] || '').trim();
    if (/^return\s/.test(debugContent)) {
      // Find the end of the return statement
      let end = debugLine;
      if (!debugContent.endsWith(';')) {
        for (let i = debugLine + 1; i < lines.length && i < debugLine + 20; i++) {
          if (stripComments(lines[i]).trim().endsWith(';')) {
            end = i;
            break;
          }
        }
      }
      return { start: debugLine, end };
    }

    // Check if the debug line is a continuation of a return statement
    for (let i = debugLine - 1; i >= 0 && i >= debugLine - 10; i--) {
      const prevContent = stripComments(lines[i]).trim();
      if (/^return\s/.test(prevContent)) {
        return { start: i, end: truncationEnd };
      }
      if (prevContent.endsWith(';') || prevContent.endsWith('{') || prevContent.endsWith('}') || prevContent.length === 0) {
        break;
      }
    }

    return null;
  }

  static findReturnRanges(lines: string[], startLine: number, endLine: number): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    const stripComments = (line: string): string => {
      const commentIndex = line.indexOf('//');
      return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
    };

    for (let i = startLine; i <= endLine; i++) {
      const content = stripComments(lines[i] || '').trim();
      if (!/^return\b/.test(content)) {
        continue;
      }

      let returnEnd = i;
      if (!content.endsWith(';')) {
        for (let j = i + 1; j <= endLine && j < i + 20; j++) {
          if (stripComments(lines[j] || '').trim().endsWith(';')) {
            returnEnd = j;
            break;
          }
        }
      }

      ranges.push({ start: i, end: returnEnd });
      i = returnEnd;
    }

    return ranges;
  }

  static wrapFunctionForDebugging(
    lines: string[],
    functionInfo: FunctionInfo,
    debugLine: number,
    varInfo: VarInfo,
    containingLoops: { lineNumber: number; endLine: number }[] = [],
    loopMaxIterations: Map<number, number> = new Map(),
    customParameters: Map<number, string> = new Map(),
    normalizeMode: string = 'off',
    stepEdge: number | null = null,
  ): string {
    const captureVarName = '_dbgCaptured';
    const debugFunctionName = `_dbg_${functionInfo.name}`;
    const sourceSegments = CodeGenerator.splitSourceForHelperWrapper(lines, functionInfo);
    const originalTarget = lines.slice(functionInfo.start, functionInfo.end + 1);

    // Determine truncation end: outermost loop endLine or debug line
    let truncationEnd: number;
    if (containingLoops.length > 0) {
      truncationEnd = containingLoops[0].endLine;
    } else {
      truncationEnd = debugLine;
      // Extend for multi-line statements
      truncationEnd = CodeGenerator.extendForMultiLine(lines, truncationEnd);
    }
    truncationEnd = CodeGenerator.extendForPreprocessorConditionals(lines, functionInfo.start, truncationEnd);

    // Detect return statement range on the debug line
    const returnRange = CodeGenerator.findReturnRange(lines, debugLine, truncationEnd);
    const useCaptureSideChannel = returnRange !== null && varInfo.name !== '_dbgReturn';
    const returnRanges = CodeGenerator.findReturnRanges(lines, functionInfo.start, truncationEnd);
    const returnRangeMap = new Map(returnRanges.map(range => [range.start, range]));

    const functionLines = [];
    for (let i = functionInfo.start; i <= truncationEnd; i++) {
      let line = lines[i];

      if (i === functionInfo.start) {
        line = CodeGenerator.renameFunctionSignature(
          line,
          functionInfo.name!,
          debugFunctionName,
          useCaptureSideChannel ? undefined : varInfo.type,
        );
      }

      const currentReturnRange = returnRangeMap.get(i);
      if (currentReturnRange) {
        const indent = line.match(/^\s*/)?.[0] || '  ';
        const isTargetReturn =
          returnRange !== null &&
          currentReturnRange.start === returnRange.start &&
          currentReturnRange.end === returnRange.end;

        if (isTargetReturn) {
          if (useCaptureSideChannel) {
            functionLines.push(`${indent}${captureVarName} = ${varInfo.name};`);
          } else if (varInfo.name === '_dbgReturn') {
            const fullReturn = lines.slice(currentReturnRange.start, currentReturnRange.end + 1).join(' ');
            const returnMatch = fullReturn.match(/^\s*return\s+(.+);/);
            if (returnMatch) {
              functionLines.push(`${indent}${varInfo.type} ${varInfo.name} = ${returnMatch[1]};`);
            }
          }
        } else {
          functionLines.push(`${indent}// Debug: stripped earlier return`);
        }

        i = currentReturnRange.end;
        if (!useCaptureSideChannel || !isTargetReturn) {
          continue;
        }
      }

      functionLines.push(line);
    }

    // Insert shadow variable if inside a loop
    const debugLineIndexInFunc = debugLine - functionInfo.start;
    const loopsRelativeToFunc = containingLoops.map(l => ({
      lineNumber: l.lineNumber - functionInfo.start,
      endLine: l.endLine - functionInfo.start,
    }));
    const { lines: withShadow, shadowVarName } = CodeGenerator.insertShadowVariable(
      functionLines, debugLineIndexInFunc, varInfo, loopsRelativeToFunc
    );

    // Cap loops
    const cappedLines = CodeGenerator.capLoopIterations(withShadow, 0, loopMaxIterations);

    // Close open braces from truncated control flow
    const closedLines = CodeGenerator.closeOpenBraces(cappedLines, 0);

    // Insert return before the appended closing braces
    const originalLength = cappedLines.length;
    const result = closedLines.slice(0, originalLength);
    if (!useCaptureSideChannel) {
      const indent = '  ';
      const returnVar = shadowVarName || varInfo.name;
      result.push(`${indent}return ${returnVar};`);
      result.push(...closedLines.slice(originalLength));
    } else {
      result.push(...closedLines.slice(originalLength));
    }

    const wrapper = [];
    wrapper.push(...sourceSegments.beforeTarget);
    wrapper.push(...originalTarget);
    wrapper.push(...sourceSegments.afterTargetBeforeMainImage);
    wrapper.push(...sourceSegments.afterMainImage);
    wrapper.push('');
    if (useCaptureSideChannel) {
      wrapper.push(`${varInfo.type} ${captureVarName};`);
    }
    wrapper.push(...result);
    wrapper.push('');
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    const call = useCaptureSideChannel
      ? CodeGenerator.generateProcedureCall(lines, debugFunctionName, functionInfo, captureVarName, varInfo.type, customParameters, normalizeMode, stepEdge)
      : CodeGenerator.generateFunctionCall(lines, debugFunctionName, functionInfo, varInfo, customParameters, normalizeMode, stepEdge);
    wrapper.push(call);
    wrapper.push('}');

    return wrapper.join('\n');
  }

  /**
   * Wraps a full (untruncated) function for debugging.
   * Used when inside a non-mainImage function but no variable is detected on the
   * current line — runs the entire function and visualizes its return value.
   */
  static wrapFullFunctionForDebugging(
    lines: string[],
    functionInfo: FunctionInfo,
    returnType: string,
    loopMaxIterations: Map<number, number> = new Map(),
    customParameters: Map<number, string> = new Map(),
    normalizeMode: string = 'off',
    stepEdge: number | null = null,
  ): string {
    const sourceSegments = CodeGenerator.splitSourceForHelperWrapper(lines, functionInfo);
    const debugFunctionName = `_dbg_${functionInfo.name}`;
    const originalTarget = lines.slice(functionInfo.start, functionInfo.end + 1);

    // The full function body, unmodified
    const functionLines: string[] = [];
    for (let i = functionInfo.start; i <= functionInfo.end; i++) {
      if (i === functionInfo.start) {
        functionLines.push(CodeGenerator.renameFunctionSignature(lines[i], functionInfo.name!, debugFunctionName));
      } else {
        functionLines.push(lines[i]);
      }
    }

    // Cap loops in the full function body
    const cappedLines = CodeGenerator.capLoopIterations(functionLines, 0, loopMaxIterations);

    // Build varInfo for the return type visualization
    const varInfo: VarInfo = { name: 'result', type: returnType };

    // Build the wrapper
    const wrapper: string[] = [];
    wrapper.push(...sourceSegments.beforeTarget);
    wrapper.push(...originalTarget);
    wrapper.push(...sourceSegments.afterTargetBeforeMainImage);
    wrapper.push(...sourceSegments.afterMainImage);
    wrapper.push('');
    wrapper.push(...cappedLines);
    wrapper.push('');
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    const call = CodeGenerator.generateFunctionCall(lines, debugFunctionName, functionInfo, varInfo, customParameters, normalizeMode, stepEdge);
    wrapper.push(call);
    wrapper.push('}');

    return wrapper.join('\n');
  }

  /**
   * Applies post-processing (normalize/step) to the full mainImage output.
   * Returns modified code or null if no post-processing is needed.
   */
  static applyOutputPostProcessing(
    originalCode: string,
    normalizeMode: string,
    stepEdge: number | null,
  ): string | null {
    if (normalizeMode === 'off' && stepEdge === null) {
      return null;
    }

    const lines = originalCode.split('\n');

    // Find the mainImage function signature
    let mainImageLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/void\s+mainImage\s*\(/.test(lines[i])) {
        mainImageLine = i;
        break;
      }
    }

    if (mainImageLine === -1) {
      return null;
    }

    // Find the closing brace by tracking brace depth
    let braceDepth = 0;
    let closingBraceLine = -1;
    let braceStarted = false;

    for (let i = mainImageLine; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') { braceDepth++; braceStarted = true; }
        if (char === '}') { braceDepth--; }
      }
      if (braceStarted && braceDepth === 0) {
        closingBraceLine = i;
        break;
      }
    }

    if (closingBraceLine === -1) {
      return null;
    }

    // Build post-processing lines
    const postLines: string[] = [];

    if (normalizeMode === 'soft') {
      postLines.push('  fragColor.rgb = fragColor.rgb / (abs(fragColor.rgb) + vec3(1.0)) * 0.5 + 0.5;');
    } else if (normalizeMode === 'abs') {
      postLines.push('  fragColor.rgb = abs(fragColor.rgb) / (abs(fragColor.rgb) + vec3(1.0));');
    }

    if (stepEdge !== null) {
      const edge = stepEdge.toFixed(4);
      postLines.push(`  fragColor = vec4(step(vec3(${edge}), fragColor.rgb), 1.0);`);
    }

    // Insert before closing brace
    const result = [...lines];
    result.splice(closingBraceLine, 0, ...postLines);
    return result.join('\n');
  }

  static wrapOneLinerForDebugging(
    lineContent: string,
    varInfo: VarInfo,
    normalizeMode: string = 'off',
    stepEdge: number | null = null,
  ): string {
    const wrapper = [];
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    wrapper.push(`  ${lineContent.trim()}`);
    wrapper.push(`  ${CodeGenerator.generateReturnStatementForVar(varInfo.type, varInfo.name, normalizeMode, stepEdge)}`);
    wrapper.push('}');
    return wrapper.join('\n');
  }

  private static splitSourceForHelperWrapper(
    lines: string[],
    functionInfo: FunctionInfo,
  ): { beforeTarget: string[]; afterTargetBeforeMainImage: string[]; afterMainImage: string[] } {
    const mainImageRange = CodeGenerator.findMainImageRange(lines);
    const beforeTarget = lines.slice(0, functionInfo.start);
    const afterTargetStart = functionInfo.end + 1;

    if (mainImageRange === null) {
      return {
        beforeTarget,
        afterTargetBeforeMainImage: lines.slice(afterTargetStart),
        afterMainImage: [],
      };
    }

    return {
      beforeTarget,
      afterTargetBeforeMainImage: lines.slice(afterTargetStart, mainImageRange.start),
      afterMainImage: lines.slice(mainImageRange.end + 1),
    };
  }

  private static findMainImageRange(lines: string[]): { start: number; end: number } | null {
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/void\s+mainImage\s*\(/.test(lines[i])) {
        start = i;
        break;
      }
    }

    if (start === -1) {
      return null;
    }

    let braceDepth = 0;
    let started = false;
    for (let i = start; i < lines.length; i++) {
      const stripped = lines[i].replace(/\/\/.*$/, '');
      for (const char of stripped) {
        if (char === '{') {
          braceDepth++;
          started = true;
        }
        if (char === '}') {
          braceDepth--;
        }
      }
      if (started && braceDepth === 0) {
        return { start, end: i };
      }
    }

    return null;
  }

  private static renameFunctionSignature(
    line: string,
    originalName: string,
    newName: string,
    newReturnType?: string,
  ): string {
    // Only rename the cloned debug helper signature. The original helper must stay
    // untouched so any existing callers in preserved shader source keep working.
    const escapedName = originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const signaturePattern = new RegExp(
      `^(\\s*)(void|float|vec2|vec3|vec4|mat2|mat3|mat4)(\\s+)${escapedName}(\\s*\\()`
    );

    return line.replace(
      signaturePattern,
      (_match, indent, returnType, spacing, openParen) =>
        `${indent}${newReturnType ?? returnType}${spacing}${newName}${openParen}`,
    );
  }
}
