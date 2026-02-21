import type { FunctionInfo, VarInfo } from './GlslParser';

export class CodeGenerator {
  static generateReturnStatementForVar(varType: string, varName: string): string {
    switch (varType) {
      case 'float':
        return `  fragColor = vec4(vec3(${varName}), 1.0); // Debug: visualize float as grayscale`;
      case 'vec2':
        return `  fragColor = vec4(${varName}, 0.0, 1.0); // Debug: visualize vec2 (RG channels)`;
      case 'vec3':
        return `  fragColor = vec4(${varName}, 1.0); // Debug: visualize vec3 as RGB`;
      case 'vec4':
        return `  fragColor = ${varName}; // Debug: visualize vec4 directly`;
      case 'mat2':
        return `  fragColor = vec4(${varName}[0], ${varName}[1]); // Debug: visualize mat2 as vec4`;
      case 'mat3':
        return `  fragColor = vec4(${varName}[0], 1.0); // Debug: visualize mat3 first row`;
      case 'mat4':
        return `  fragColor = ${varName}[0]; // Debug: visualize mat4 first row`;
      default:
        return '  fragColor = vec4(1.0, 0.0, 1.0, 1.0); // Debug: unknown type';
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

    const visualization = CodeGenerator.generateReturnStatementForVar(varInfo.type, 'result');
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
    const call = CodeGenerator.generateFunctionCall(lines, functionInfo.name!, functionInfo, varInfo, customParameters);
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
    const call = CodeGenerator.generateFunctionCall(lines, functionInfo.name!, functionInfo, varInfo, customParameters);
    wrapper.push(call);
    wrapper.push('}');

    return wrapper.join('\n');
  }

  static wrapOneLinerForDebugging(
    lineContent: string,
    varInfo: VarInfo
  ): string {
    const wrapper = [];
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    wrapper.push(`  ${lineContent.trim()}`);
    wrapper.push(`  ${CodeGenerator.generateReturnStatementForVar(varInfo.type, varInfo.name)}`);
    wrapper.push('}');
    return wrapper.join('\n');
  }
}
