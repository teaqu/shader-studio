import type { FunctionInfo, VarInfo } from './GlslParser';

export class CodeGenerator {
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
   * Counts unmatched opening braces after functionStart and appends
   * the right number of closing braces. Keeps all lines intact.
   */
  static closeOpenBraces(lines: string[], functionStart: number): string[] {
    const result = [...lines];
    let braceDepth = 0;

    for (let i = functionStart; i < lines.length; i++) {
      for (const char of lines[i]) {
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

    const funcLine = lines[functionInfo.start];
    const paramsMatch = funcLine.match(/\(([^)]*)\)/);

    if (!paramsMatch || !paramsMatch[1].trim()) {
      return { args: '', setup: [] };
    }

    const paramsStr = paramsMatch[1];
    const paramPairs = paramsStr.split(',').map(p => p.trim());

    for (const pair of paramPairs) {
      const match = pair.match(/^\s*(vec2|vec3|vec4|float|int|bool|mat2|mat3|mat4|sampler2D)\s+(\w+)\s*$/);

      if (match) {
        const type = match[1];

        switch (type) {
          case 'vec2':
            if (!setup.some(s => s.includes('vec2 uv'))) {
              setup.push('  vec2 uv = fragCoord / iResolution.xy;');
            }
            args.push('uv');
            break;
          case 'vec3':
            args.push('vec3(0.5)');
            break;
          case 'vec4':
            args.push('vec4(0.5)');
            break;
          case 'float':
            args.push('0.5');
            break;
          case 'int':
            args.push('1');
            break;
          case 'bool':
            args.push('true');
            break;
          case 'mat2':
            args.push('mat2(1.0)');
            break;
          case 'mat3':
            args.push('mat3(1.0)');
            break;
          case 'mat4':
            args.push('mat4(1.0)');
            break;
          case 'sampler2D':
            args.push('iChannel0');
            break;
          default:
            args.push('0.0');
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
    const helperFunctions: string[] = [];
    for (let i = 0; i < functionInfo.start; i++) {
      helperFunctions.push(lines[i]);
    }

    // Determine truncation end: outermost loop endLine or debug line
    let truncationEnd: number;
    if (containingLoops.length > 0) {
      truncationEnd = containingLoops[0].endLine;
    } else {
      truncationEnd = debugLine;
    }

    const functionLines = [];
    for (let i = functionInfo.start; i <= truncationEnd; i++) {
      let line = lines[i];

      if (i === functionInfo.start) {
        line = line.replace(
          /^\s*(void|float|vec2|vec3|vec4|mat2|mat3|mat4)(\s+\w+\s*\()/,
          `${varInfo.type}$2`
        );
      }

      if (i === debugLine && varInfo.name === '_dbgReturn') {
        const returnMatch = line.match(/^\s*return\s+(.+);/);
        if (returnMatch) {
          const expression = returnMatch[1];
          const indent = line.match(/^\s*/)?.[0] || '  ';
          line = `${indent}${varInfo.type} ${varInfo.name} = ${expression};`;
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
    const indent = '  ';
    const returnVar = shadowVarName || varInfo.name;
    result.push(`${indent}return ${returnVar};`);
    result.push(...closedLines.slice(originalLength));

    const wrapper = [];
    wrapper.push(...helperFunctions);
    wrapper.push(...result);
    wrapper.push('');
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    const call = CodeGenerator.generateFunctionCall(lines, functionInfo.name!, functionInfo, varInfo, customParameters, normalizeMode, stepEdge);
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
    // Everything before the function
    const helperFunctions: string[] = [];
    for (let i = 0; i < functionInfo.start; i++) {
      helperFunctions.push(lines[i]);
    }

    // The full function body, unmodified
    const functionLines: string[] = [];
    for (let i = functionInfo.start; i <= functionInfo.end; i++) {
      functionLines.push(lines[i]);
    }

    // Cap loops in the full function body
    const cappedLines = CodeGenerator.capLoopIterations(functionLines, 0, loopMaxIterations);

    // Build varInfo for the return type visualization
    const varInfo: VarInfo = { name: 'result', type: returnType };

    // Build the wrapper
    const wrapper: string[] = [];
    wrapper.push(...helperFunctions);
    wrapper.push(...cappedLines);
    wrapper.push('');
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    const call = CodeGenerator.generateFunctionCall(lines, functionInfo.name!, functionInfo, varInfo, customParameters, normalizeMode, stepEdge);
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
}
