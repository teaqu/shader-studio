import { GlslParser } from './GlslParser';
import type { FunctionInfo, VarInfo } from './GlslParser';
import type { ShaderDialect } from './types';
import { canonicalShaderType, getDebugDialect } from './dialects';

export class CodeGenerator {
  /** Maps Slang type names onto their GLSL equivalents for switch dispatch. */
  static canonicalType(type: string): string {
    return canonicalShaderType(type);
  }

  /** Vector constructor name for the dialect (vec3 vs float3). */
  private static vec(dialect: ShaderDialect, n: 2 | 3 | 4): string {
    return getDebugDialect(dialect).vectorCtor(n);
  }

  /** Regex matching the user's mainImage signature for the dialect. */
  static mainImagePattern(dialect: ShaderDialect): RegExp {
    return getDebugDialect(dialect).mainImagePattern;
  }

  /** Opening line of a generated mainImage wrapper for the dialect. */
  private static mainImageWrapperOpen(dialect: ShaderDialect): string {
    return getDebugDialect(dialect).mainImageWrapperOpen();
  }

  private static defaultParameterValue(type: string, dialect: ShaderDialect = 'glsl'): string | null {
    return getDebugDialect(dialect).defaultParameterValue(CodeGenerator.canonicalType(type));
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

  /**
   * Builds the color expression and comment visualizing a variable, using the
   * dialect's vector constructor names. varType may be a GLSL or Slang type.
   */
  private static buildVisualizationExpr(
    varType: string,
    varName: string,
    normalizeMode: string,
    dialect: ShaderDialect,
  ): { expr: string; comment: string } {
    const v2 = CodeGenerator.vec(dialect, 2);
    const v3 = CodeGenerator.vec(dialect, 3);
    const v4 = CodeGenerator.vec(dialect, 4);
    const canonical = CodeGenerator.canonicalType(varType);

    if (normalizeMode === 'soft') {
      switch (canonical) {
        case 'float': {
          const n = CodeGenerator.softNormExpr(varName);
          return { expr: `${v4}(${v3}(${n}), 1.0)`, comment: `soft normalized ${varType}` };
        }
        case 'vec2': {
          const n = `(${varName} / (abs(${varName}) + ${v2}(1.0)) * 0.5 + 0.5)`;
          return { expr: `${v4}(${n}, 0.0, 1.0)`, comment: `soft normalized ${varType}` };
        }
        case 'vec3': {
          const n = `(${varName} / (abs(${varName}) + ${v3}(1.0)) * 0.5 + 0.5)`;
          return { expr: `${v4}(${n}, 1.0)`, comment: `soft normalized ${varType}` };
        }
        case 'vec4': {
          const rgb = `(${varName}.rgb / (abs(${varName}.rgb) + ${v3}(1.0)) * 0.5 + 0.5)`;
          return { expr: `${v4}(${rgb}, 1.0)`, comment: `soft normalized ${varType}` };
        }
        default:
          return CodeGenerator.buildVisualizationExpr(varType, varName, 'off', dialect);
      }
    }

    if (normalizeMode === 'abs') {
      switch (canonical) {
        case 'float': {
          const n = CodeGenerator.absNormExpr(varName);
          return { expr: `${v4}(${v3}(${n}), 1.0)`, comment: `abs normalized ${varType}` };
        }
        case 'vec2': {
          const n = `(abs(${varName}) / (abs(${varName}) + ${v2}(1.0)))`;
          return { expr: `${v4}(${n}, 0.0, 1.0)`, comment: `abs normalized ${varType}` };
        }
        case 'vec3': {
          const n = `(abs(${varName}) / (abs(${varName}) + ${v3}(1.0)))`;
          return { expr: `${v4}(${n}, 1.0)`, comment: `abs normalized ${varType}` };
        }
        case 'vec4': {
          const rgb = `(abs(${varName}.rgb) / (abs(${varName}.rgb) + ${v3}(1.0)))`;
          return { expr: `${v4}(${rgb}, 1.0)`, comment: `abs normalized ${varType}` };
        }
        default:
          return CodeGenerator.buildVisualizationExpr(varType, varName, 'off', dialect);
      }
    }

    switch (canonical) {
      case 'float':
        return { expr: `${v4}(${v3}(${varName}), 1.0)`, comment: `visualize ${varType} as grayscale` };
      case 'int':
        return { expr: `${v4}(${v3}(float(${varName})), 1.0)`, comment: `visualize ${varType} as grayscale` };
      case 'bool':
        return { expr: `${v4}(${v3}(${varName} ? 1.0 : 0.0), 1.0)`, comment: `visualize ${varType} as grayscale` };
      case 'vec2':
        return { expr: `${v4}(${varName}, 0.0, 1.0)`, comment: `visualize ${varType} (RG channels)` };
      case 'vec3':
        return { expr: `${v4}(${varName}, 1.0)`, comment: `visualize ${varType} as RGB` };
      case 'vec4':
        return { expr: varName, comment: `visualize ${varType} directly` };
      case 'mat2':
        return { expr: `${v4}(${varName}[0], ${varName}[1])`, comment: `visualize ${varType} as ${v4}` };
      case 'mat3':
        return { expr: `${v4}(${varName}[0], 1.0)`, comment: `visualize ${varType} first row` };
      case 'mat4':
        return { expr: `${varName}[0]`, comment: `visualize ${varType} first row` };
      default:
        return { expr: `${v4}(1.0, 0.0, 1.0, 1.0)`, comment: 'unknown type' };
    }
  }

  static generateReturnStatementForVar(
    varType: string,
    varName: string,
    normalizeMode: string = 'off',
    stepEdge: number | null = null,
    dialect: ShaderDialect = 'glsl',
  ): string {
    const { expr, comment } = CodeGenerator.buildVisualizationExpr(varType, varName, normalizeMode, dialect);
    return getDebugDialect(dialect).visualOutputStatement(expr, comment, stepEdge);
  }

  /**
   * Generates the capture-mode output statement (raw float output, no
   * normalization). Used by VariableCaptureBuilder for off-canvas float
   * FBO capture. GLSL assigns fragColor; Slang returns the value.
   */
  static generateCaptureOutputForVar(varType: string, varName: string, dialect: ShaderDialect = 'glsl'): string {
    return getDebugDialect(dialect).captureOutputStatement(varType, varName);
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
   * and inserts `_dbgShadow = {varName};` after the selected statement.
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
    const insertionIndex = CodeGenerator.extendForMultiLine(lines, debugLineIndex);
    const debugIndent = lines[insertionIndex]?.match(/^(\s*)/)?.[1] || lines[debugLineIndex]?.match(/^(\s*)/)?.[1] || '    ';

    for (let i = 0; i < lines.length; i++) {
      if (i === outermostLoopIndex) {
        result.push(`${indent}${varInfo.type} ${shadowVarName};`);
      }
      result.push(lines[i]);
      if (i === insertionIndex) {
        result.push(`${debugIndent}${shadowVarName} = ${varInfo.name};`);
      }
    }

    return { lines: result, shadowVarName };
  }

  static generateDefaultParameters(
    lines: string[],
    functionInfo: FunctionInfo,
    dialect: ShaderDialect = 'glsl',
  ): { args: string; setup: string[] } {
    const setup: string[] = [];
    const args: string[] = [];

    const signature = GlslParser.getFullFunctionSignature(lines, functionInfo.start);
    const paramsMatch = signature.match(/\(([^)]*)\)/s);

    if (!paramsMatch || !paramsMatch[1].trim()) {
      return { args: '', setup: [] };
    }

    const v2 = CodeGenerator.vec(dialect, 2);
    const paramsStr = paramsMatch[1];
    const paramPairs = paramsStr.split(',').map(p => p.trim());

    for (const pair of paramPairs) {
      const match = pair.match(/^\s*(?:(?:const|highp|mediump|lowp)\s+)*(?:(in|out|inout)\s+)?(?:(?:const|highp|mediump|lowp)\s+)*([A-Za-z_]\w*)\s+(\w+)\s*$/);

      if (match) {
        const qualifier = match[1];
        const type = match[2];
        const defaultValue = CodeGenerator.defaultParameterValue(type, dialect);
        const tempName = `_dbgArg${args.length}`;
        const needsTemp = qualifier === 'out' || qualifier === 'inout' || defaultValue === null;

        switch (CodeGenerator.canonicalType(type)) {
          case 'vec2':
            if (!setup.some(s => s.includes(`${v2} uv`))) {
              setup.push(`  ${v2} uv = fragCoord / iResolution.xy;`);
            }
            if (needsTemp) {
              if (defaultValue === null) {
                setup.push(`  ${type} ${tempName};`);
              } else {
                setup.push(`  ${type} ${tempName} = ${defaultValue};`);
              }
              args.push(tempName);
            } else {
              args.push(defaultValue);
            }
            break;
          default: {
            if (needsTemp) {
              if (defaultValue === null) {
                setup.push(`  ${type} ${tempName};`);
              } else {
                setup.push(`  ${type} ${tempName} = ${defaultValue};`);
              }
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
    dialect: ShaderDialect = 'glsl',
  ): string {
    const params = CodeGenerator.generateDefaultParameters(lines, functionInfo, dialect);
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
      setup = setup.filter(s => !s.includes(' uv = '));
    }

    const visualization = CodeGenerator.generateReturnStatementForVar(varInfo.type, 'result', normalizeMode, stepEdge, dialect);
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
    dialect: ShaderDialect = 'glsl',
  ): string {
    const params = CodeGenerator.generateDefaultParameters(lines, functionInfo, dialect);
    const defaultArgs = params.args ? params.args.split(', ') : [];

    const args = defaultArgs.map((arg, index) => {
      const custom = customParameters.get(index);
      return custom !== undefined ? custom : arg;
    });

    let setup = [...params.setup];
    const anyArgUsesUv = args.some(arg => arg === 'uv' || arg.includes('uv'));
    if (!anyArgUsesUv) {
      setup = setup.filter(s => !s.includes(' uv = '));
    }

    const visualization = CodeGenerator.generateReturnStatementForVar(targetVarType, targetVarName, normalizeMode, stepEdge, dialect);
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

  static stripReturnStatements(lines: string[]): string[] {
    if (lines.length === 0) {
      return [];
    }

    const inlineReturnPattern = /\breturn\b[^;]*;/;
    const returnRangeMap = new Map(
      CodeGenerator.findReturnRanges(lines, 0, lines.length - 1).map(range => [range.start, range])
    );
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const inlineMatchIndex = lines[i].search(/\breturn\b/);
      if (inlineMatchIndex > 0 && inlineReturnPattern.test(lines[i])) {
        result.push(lines[i].replace(inlineReturnPattern, '; // Debug: stripped return'));
        continue;
      }

      const returnRange = returnRangeMap.get(i);
      if (!returnRange) {
        result.push(lines[i]);
        continue;
      }

      const indent = lines[i].match(/^\s*/)?.[0] || '  ';
      result.push(`${indent}// Debug: stripped return`);
      i = returnRange.end;
    }

    return result;
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
    dialect: ShaderDialect = 'glsl',
  ): string {
    const captureVarName = '_dbgCaptured';
    const debugFunctionName = `_dbg_${functionInfo.name}`;
    const preservedSource = CodeGenerator.splitSourceForHelperWrapper(lines, dialect);

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

    if (!useCaptureSideChannel && varInfo.name !== '_dbgReturn') {
      // If the debug clone now returns a different type than the original helper,
      // strip any residual source returns before appending the debug return.
      functionLines.splice(0, functionLines.length, ...CodeGenerator.stripReturnStatements(functionLines));
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
    wrapper.push(...preservedSource);
    wrapper.push('');
    if (useCaptureSideChannel) {
      wrapper.push(getDebugDialect(dialect).moduleCaptureDeclaration(varInfo.type, captureVarName));
    }
    wrapper.push(...result);
    wrapper.push('');
    wrapper.push(CodeGenerator.mainImageWrapperOpen(dialect));
    const call = useCaptureSideChannel
      ? CodeGenerator.generateProcedureCall(lines, debugFunctionName, functionInfo, captureVarName, varInfo.type, customParameters, normalizeMode, stepEdge, dialect)
      : CodeGenerator.generateFunctionCall(lines, debugFunctionName, functionInfo, varInfo, customParameters, normalizeMode, stepEdge, dialect);
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
    dialect: ShaderDialect = 'glsl',
  ): string {
    const preservedSource = CodeGenerator.splitSourceForHelperWrapper(lines, dialect);
    const debugFunctionName = `_dbg_${functionInfo.name}`;

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
    wrapper.push(...preservedSource);
    wrapper.push('');
    wrapper.push(...cappedLines);
    wrapper.push('');
    wrapper.push(CodeGenerator.mainImageWrapperOpen(dialect));
    const call = CodeGenerator.generateFunctionCall(lines, debugFunctionName, functionInfo, varInfo, customParameters, normalizeMode, stepEdge, dialect);
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
    dialect: ShaderDialect = 'glsl',
  ): string | null {
    if (normalizeMode === 'off' && stepEdge === null) {
      return null;
    }

    const lines = originalCode.split('\n');
    const mainImagePattern = CodeGenerator.mainImagePattern(dialect);

    // Find the mainImage function signature
    let mainImageLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (mainImagePattern.test(lines[i])) {
        mainImageLine = i;
        break;
      }
    }

    if (mainImageLine === -1) {
      return null;
    }

    const dialectAdapter = getDebugDialect(dialect);
    if (dialectAdapter.mainImageReturnsValue) {
      // Slang mainImage returns its color (possibly from several return
      // statements), so post-processing cannot be injected before a closing
      // brace. Rename the user's mainImage and wrap it instead.
      const postLines = CodeGenerator.buildPostProcessingLines(normalizeMode, stepEdge, dialect);
      const result = [...lines];
      result[mainImageLine] = CodeGenerator.renameFunctionSignature(
        result[mainImageLine],
        'mainImage',
        '_dbgUserMain',
      );
      result.push(
        '',
        dialectAdapter.mainImageWrapperOpen(),
        `  ${dialectAdapter.vectorCtor(4)} fragColor = _dbgUserMain(fragCoord);`,
        ...postLines,
        '  return fragColor;',
        '}',
      );
      return result.join('\n');
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

    // Insert before closing brace
    const postLines = CodeGenerator.buildPostProcessingLines(normalizeMode, stepEdge, dialect);
    const result = [...lines];
    result.splice(closingBraceLine, 0, ...postLines);
    return result.join('\n');
  }

  private static buildPostProcessingLines(
    normalizeMode: string,
    stepEdge: number | null,
    dialect: ShaderDialect,
  ): string[] {
    const v3 = CodeGenerator.vec(dialect, 3);
    const v4 = CodeGenerator.vec(dialect, 4);
    const postLines: string[] = [];

    if (normalizeMode === 'soft') {
      postLines.push(`  fragColor.rgb = fragColor.rgb / (abs(fragColor.rgb) + ${v3}(1.0)) * 0.5 + 0.5;`);
    } else if (normalizeMode === 'abs') {
      postLines.push(`  fragColor.rgb = abs(fragColor.rgb) / (abs(fragColor.rgb) + ${v3}(1.0));`);
    }

    if (stepEdge !== null) {
      const edge = stepEdge.toFixed(4);
      postLines.push(`  fragColor = ${v4}(step(${v3}(${edge}), fragColor.rgb), 1.0);`);
    }

    return postLines;
  }

  static wrapOneLinerForDebugging(
    lineContent: string,
    varInfo: VarInfo,
    normalizeMode: string = 'off',
    stepEdge: number | null = null,
    dialect: ShaderDialect = 'glsl',
  ): string {
    const wrapper = [];
    wrapper.push(CodeGenerator.mainImageWrapperOpen(dialect));
    wrapper.push(`  ${lineContent.trim()}`);
    wrapper.push(`  ${CodeGenerator.generateReturnStatementForVar(varInfo.type, varInfo.name, normalizeMode, stepEdge, dialect)}`);
    wrapper.push('}');
    return wrapper.join('\n');
  }

  static wrapGlobalScopeForDebugging(
    lines: string[],
    varInfo: VarInfo,
    normalizeMode: string = 'off',
    stepEdge: number | null = null,
    dialect: ShaderDialect = 'glsl',
  ): string {
    const preservedSource = CodeGenerator.splitSourceForHelperWrapper(lines, dialect);

    return [
      ...preservedSource,
      '',
      CodeGenerator.mainImageWrapperOpen(dialect),
      CodeGenerator.generateReturnStatementForVar(varInfo.type, varInfo.name, normalizeMode, stepEdge, dialect),
      '}',
    ].join('\n');
  }

  private static splitSourceForHelperWrapper(
    lines: string[],
    dialect: ShaderDialect = 'glsl',
  ): string[] {
    const mainImageRange = CodeGenerator.findMainImageRange(lines, dialect);
    if (mainImageRange === null) {
      return [...lines];
    }

    return [
      ...lines.slice(0, mainImageRange.start),
      ...lines.slice(mainImageRange.end + 1),
    ];
  }

  private static findMainImageRange(lines: string[], dialect: ShaderDialect = 'glsl'): { start: number; end: number } | null {
    const mainImagePattern = CodeGenerator.mainImagePattern(dialect);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (mainImagePattern.test(lines[i])) {
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
      `^(\\s*)((?:(?:public|private|internal|static|inline|extern|export|__exported)\\s+)*)([A-Za-z_]\\w*)(\\s+)${escapedName}(\\s*\\()`,
    );

    return line.replace(
      signaturePattern,
      (_match, indent, modifiers, returnType, spacing, openParen) =>
        `${indent}${modifiers}${newReturnType ?? returnType}${spacing}${newName}${openParen}`,
    );
  }
}
