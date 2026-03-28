import { GlslParser } from './GlslParser';
import { CodeGenerator } from './CodeGenerator';
import { ShaderDebugger } from './ShaderDebugger';
import type { CaptureVarInfo } from './types';

// Types capturable by the variable inspector (mat2 fits in RGBA, mat3/mat4 excluded)
const CAPTURABLE_TYPES = new Set(['float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2']);

const DEFAULT_GRID_SIZE = 64;

export class VariableCaptureBuilder {
  /**
   * Get all capturable in-scope variables (float, int, bool, vec2, vec3, vec4).
   * Max 15 returned.
   * debugLine = -1 uses last line of mainImage ("whole shader" mode).
   */
  static getAllInScopeVariables(code: string, debugLine: number): CaptureVarInfo[] {
    const lines = code.split('\n');

    let resolvedLine = debugLine;

    if (debugLine === -1) {
      // Whole-shader mode: find mainImage and use last line of its body
      const mainImageLine = VariableCaptureBuilder.findMainImageStart(lines);
      if (mainImageLine === -1) return [];
      const mainImageEnd = VariableCaptureBuilder.findFunctionEnd(lines, mainImageLine);
      if (mainImageEnd === -1) return [];
      // Use the line just before the closing brace
      resolvedLine = mainImageEnd - 1;
    }

    const functionInfo = GlslParser.findEnclosingFunction(lines, resolvedLine);
    if (!functionInfo.name) {
      return GlslParser.getGlobalVariables(lines)
        .filter((globalVar) => CAPTURABLE_TYPES.has(globalVar.type))
        .slice(0, 15)
        .map((globalVar) => ({
          varName: globalVar.name,
          varType: globalVar.type,
          declarationLine: globalVar.declarationLine,
        }));
    }

    // If on closing brace of function, treat as last line of body
    if (functionInfo.end >= 0 && resolvedLine === functionInfo.end) {
      resolvedLine = functionInfo.end - 1;
    }

    const varTypes = GlslParser.buildVariableTypeMap(lines, resolvedLine, functionInfo);
    const varLineMap = GlslParser.buildVariableLineMap(lines, resolvedLine, functionInfo, varTypes);
    const globalVars = functionInfo.name
      ? GlslParser.getUsedGlobalVariables(lines, functionInfo)
      : GlslParser.getGlobalVariables(lines);

    // In mainImage, defer fragColor to append at the end of the list
    const isMainImage = functionInfo.name === 'mainImage';
    let fragColorType: string | null = null;
    let fragColorLine = -1;

    const result: CaptureVarInfo[] = [];
    for (const [varName, varType] of varTypes) {
      if (CAPTURABLE_TYPES.has(varType)) {
        if (isMainImage && varName === 'fragColor') {
          fragColorType = varType;
          fragColorLine = varLineMap.get(varName) ?? functionInfo.start;
          continue;
        }
        result.push({ varName, varType, declarationLine: varLineMap.get(varName) ?? functionInfo.start });
        if (result.length >= 15) break;
      }
    }

    for (const globalVar of globalVars) {
      if (!CAPTURABLE_TYPES.has(globalVar.type) || varTypes.has(globalVar.name)) {
        continue;
      }
      result.push({
        varName: globalVar.name,
        varType: globalVar.type,
        declarationLine: globalVar.declarationLine,
      });
      if (result.length >= 15) break;
    }

    // If the debug line is a return statement, add a synthetic _dbgReturn variable
    // so the return value appears in the variable preview panel.
    // Uses detectVariableAndType to handle multi-line returns correctly.
    if (debugLine !== -1 && functionInfo.start >= 0 && result.length < 15) {
      const funcLine = GlslParser.getFullFunctionSignature(lines, functionInfo.start);
      const returnTypeMatch = funcLine.match(
        /^\s*(float|vec2|vec3|vec4|int|bool|mat2)\s+\w+\s*\(/
      );
      if (returnTypeMatch && CAPTURABLE_TYPES.has(returnTypeMatch[1])) {
        const lineContent = lines[resolvedLine] || '';
        const varInfo = GlslParser.detectVariableAndType(
          lineContent, varTypes, returnTypeMatch[1], lines, resolvedLine, false
        );
        if (varInfo && varInfo.name === '_dbgReturn') {
          result.push({ varName: '_dbgReturn', varType: returnTypeMatch[1], declarationLine: resolvedLine });
        }
      }
    }

    // Append fragColor last so it always appears at the bottom in mainImage
    if (fragColorType && result.length < 15) {
      result.push({ varName: 'fragColor', varType: fragColorType, declarationLine: fragColorLine });
    }

    return result;
  }

  /**
   * Generate a capture shader that outputs varName to fragColor as raw floats.
   * captureCoordUniform=true injects uniform vec2 _dbgCaptureCoord and uses it as fragCoord.
   * Returns null if var cannot be captured.
   */
  static generateCaptureShader(
    code: string,
    debugLine: number,
    varName: string,
    varType: string,
    loopMaxIterations: Map<number, number>,
    customParameters: Map<number, string>,
    captureCoordUniform: boolean,
    gridWidth: number = DEFAULT_GRID_SIZE,
    gridHeight: number = DEFAULT_GRID_SIZE,
  ): string | null {
    const lines = code.split('\n');

    let resolvedLine = debugLine;
    if (debugLine === -1) {
      const mainImageLine = VariableCaptureBuilder.findMainImageStart(lines);
      if (mainImageLine === -1) return null;
      const mainImageEnd = VariableCaptureBuilder.findFunctionEnd(lines, mainImageLine);
      if (mainImageEnd === -1) return null;
      resolvedLine = mainImageEnd - 1;
    }

    const functionInfo = GlslParser.findEnclosingFunction(lines, resolvedLine);
    let varTypes = new Map<string, string>();
    let isGlobalVar = false;

    if (functionInfo.name) {
      // If on closing brace of function, treat as last line of body
      if (functionInfo.end >= 0 && resolvedLine === functionInfo.end) {
        resolvedLine = functionInfo.end - 1;
      }

      // Validate var is actually in scope (_dbgReturn is synthetic, always allowed)
      varTypes = GlslParser.buildVariableTypeMap(lines, resolvedLine, functionInfo);
      const globalVars = GlslParser.getUsedGlobalVariables(lines, functionInfo);
      isGlobalVar = globalVars.some((globalVar) => globalVar.name === varName && globalVar.type === varType);
      if (varName !== '_dbgReturn' && !varTypes.has(varName) && !isGlobalVar) return null;
    } else {
      const globalVars = GlslParser.getGlobalVariables(lines);
      isGlobalVar = globalVars.some((globalVar) => globalVar.name === varName && globalVar.type === varType);
      if (!isGlobalVar) return null;
    }

    const varInfo = { name: varName, type: varType };

    let result: string;

    if (functionInfo.name === 'mainImage') {
      result = ShaderDebugger.truncateMainImage(
        lines,
        resolvedLine,
        functionInfo.start,
        varInfo,
        loopMaxIterations,
        'off',
        null,
        true, // captureMode
      );
    } else if (functionInfo.name) {
      const containingLoops = ShaderDebugger.extractLoops(lines, functionInfo.start, resolvedLine);
      // Generate the wrapper but with capture output instead of visualization
      result = VariableCaptureBuilder.wrapFunctionForCapture(
        lines,
        functionInfo,
        resolvedLine,
        varInfo,
        containingLoops,
        loopMaxIterations,
        customParameters,
      );
    } else {
      result = VariableCaptureBuilder.wrapGlobalScopeForCapture(lines, varInfo);
    }

    // Inject coord override: pixel mode uses uniform, grid mode scales gl_FragCoord
    if (captureCoordUniform) {
      result = VariableCaptureBuilder.injectCaptureCoord(result);
    } else {
      result = VariableCaptureBuilder.injectGridCoord(result, gridWidth, gridHeight);
    }

    return result;
  }

  private static wrapGlobalScopeForCapture(
    lines: string[],
    varInfo: import('./GlslParser').VarInfo,
  ): string {
    const mainImageStart = VariableCaptureBuilder.findMainImageStart(lines);
    const mainImageEnd = mainImageStart >= 0
      ? VariableCaptureBuilder.findFunctionEnd(lines, mainImageStart)
      : -1;

    const preservedLines = mainImageStart >= 0 && mainImageEnd >= mainImageStart
      ? [
        ...lines.slice(0, mainImageStart),
        ...lines.slice(mainImageEnd + 1),
      ]
      : [...lines];

    const captureOutput = CodeGenerator.generateCaptureOutputForVar(varInfo.type, varInfo.name);
    return [
      ...preservedLines,
      '',
      'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
      captureOutput,
      '}',
    ].join('\n');
  }

  /**
   * Wraps a helper function for capture mode (raw float output).
   * Similar to CodeGenerator.wrapFunctionForDebugging but uses generateCaptureOutputForVar.
   */
  private static wrapFunctionForCapture(
    lines: string[],
    functionInfo: import('./GlslParser').FunctionInfo,
    debugLine: number,
    varInfo: import('./GlslParser').VarInfo,
    containingLoops: { lineNumber: number; endLine: number }[],
    loopMaxIterations: Map<number, number>,
    customParameters: Map<number, string>,
  ): string {
    const captureVarName = '_dbgCaptured';
    const debugFunctionName = `_dbg_${functionInfo.name}`;
    const mainImageRange = (() => {
      let start = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/void\s+mainImage\s*\(/.test(lines[i])) {
          start = i;
          break;
        }
      }
      if (start === -1) return null;
      let braceDepth = 0;
      let started = false;
      for (let i = start; i < lines.length; i++) {
        const stripped = lines[i].replace(/\/\/.*$/, '');
        for (const char of stripped) {
          if (char === '{') { braceDepth++; started = true; }
          if (char === '}') { braceDepth--; }
        }
        if (started && braceDepth === 0) {
          return { start, end: i };
        }
      }
      return null;
    })();
    const beforeTarget = lines.slice(0, functionInfo.start);
    const afterTargetStart = functionInfo.end + 1;
    const afterTargetBeforeMainImage = mainImageRange
      ? lines.slice(afterTargetStart, mainImageRange.start)
      : lines.slice(afterTargetStart);
    const afterMainImage = mainImageRange ? lines.slice(mainImageRange.end + 1) : [];
    const originalTarget = lines.slice(functionInfo.start, functionInfo.end + 1);

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
    const useCaptureSideChannel =
      returnRange !== null &&
      varInfo.name !== '_dbgReturn' &&
      VariableCaptureBuilder.isOutParameter(lines, functionInfo.start, varInfo.name);
    const returnRanges = CodeGenerator.findReturnRanges(lines, functionInfo.start, truncationEnd);
    const returnRangeMap = new Map(returnRanges.map(range => [range.start, range]));

    const functionLines = [];
    for (let i = functionInfo.start; i <= truncationEnd; i++) {
      let line = lines[i];

      if (i === functionInfo.start) {
        line = VariableCaptureBuilder.renameFunctionSignature(
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
      functionLines.splice(0, functionLines.length, ...CodeGenerator.stripReturnStatements(functionLines));
    }

    const debugLineIndexInFunc = debugLine - functionInfo.start;
    const loopsRelativeToFunc = containingLoops.map(l => ({
      lineNumber: l.lineNumber - functionInfo.start,
      endLine: l.endLine - functionInfo.start,
    }));
    const { lines: withShadow, shadowVarName } = CodeGenerator.insertShadowVariable(
      functionLines, debugLineIndexInFunc, varInfo, loopsRelativeToFunc
    );

    const cappedLines = CodeGenerator.capLoopIterations(withShadow, 0, loopMaxIterations);
    const closedLines = CodeGenerator.closeOpenBraces(cappedLines, 0);

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

    // Build the parameters for function call
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

    const captureTarget = useCaptureSideChannel ? captureVarName : 'result';
    const captureOutput = CodeGenerator.generateCaptureOutputForVar(varInfo.type, captureTarget);
    const setupCode = setup.length > 0 ? setup.join('\n') + '\n' : '';
    const callLine = useCaptureSideChannel
      ? `${setupCode}  ${debugFunctionName}(${args.join(', ')});\n${captureOutput}`
      : `${setupCode}  ${varInfo.type} result = ${debugFunctionName}(${args.join(', ')});\n${captureOutput}`;

    const wrapper = [];
    wrapper.push(...beforeTarget);
    wrapper.push(...originalTarget);
    wrapper.push(...afterTargetBeforeMainImage);
    wrapper.push(...afterMainImage);
    wrapper.push('');
    if (useCaptureSideChannel) {
      wrapper.push(`${varInfo.type} ${captureVarName};`);
    }
    wrapper.push(...result);
    wrapper.push('');
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    wrapper.push(callLine);
    wrapper.push('}');

    return wrapper.join('\n');
  }

  /**
   * Injects `uniform vec2 _dbgCaptureCoord;` and
   * `vec2 fragCoord = _dbgCaptureCoord;` at the start of mainImage body.
   */
  private static injectCaptureCoord(code: string): string {
    const lines = code.split('\n');

    // Prepend uniform declaration before the first line
    const uniformDecl = 'uniform vec2 _dbgCaptureCoord;';

    // Find mainImage and inject fragCoord override at start of body
    for (let i = 0; i < lines.length; i++) {
      if (/void\s+mainImage\s*\(/.test(lines[i])) {
        // Find the opening brace
        for (let j = i; j < lines.length && j < i + 5; j++) {
          if (lines[j].includes('{')) {
            lines.splice(j + 1, 0, '  fragCoord = _dbgCaptureCoord;');
            break;
          }
        }
        break;
      }
    }

    return uniformDecl + '\n' + lines.join('\n');
  }

  /**
   * Injects `fragCoord = gl_FragCoord.xy / vec2(gridWidth, gridHeight) * iResolution.xy;`
   * at the start of mainImage body so the grid samples cover the full canvas with correct aspect ratio.
   */
  private static injectGridCoord(code: string, gridWidth: number, gridHeight: number): string {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/void\s+mainImage\s*\(/.test(lines[i])) {
        for (let j = i; j < lines.length && j < i + 5; j++) {
          if (lines[j].replace(/\/\/.*$/, '').includes('{')) {
            lines.splice(j + 1, 0, `  fragCoord = gl_FragCoord.xy / vec2(${gridWidth}.0, ${gridHeight}.0) * iResolution.xy;`);
            break;
          }
        }
        break;
      }
    }
    return lines.join('\n');
  }

  private static renameFunctionSignature(
    line: string,
    originalName: string,
    newName: string,
    newReturnType?: string,
  ): string {
    // Only rename the cloned debug helper signature. The original helper must stay
    // untouched so any preserved callers still bind to the original symbol.
    const escapedName = originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const signaturePattern = new RegExp(
      `^(\\s*)([A-Za-z_]\\w*)(\\s+)${escapedName}(\\s*\\()`
    );

    return line.replace(
      signaturePattern,
      (_match, indent, returnType, spacing, openParen) =>
        `${indent}${newReturnType ?? returnType}${spacing}${newName}${openParen}`,
    );
  }

  private static findMainImageStart(lines: string[]): number {
    for (let i = 0; i < lines.length; i++) {
      if (/void\s+mainImage\s*\(/.test(lines[i])) {
        return i;
      }
    }
    return -1;
  }

  private static findFunctionEnd(lines: string[], functionStart: number): number {
    let braceDepth = 0;
    let started = false;
    for (let i = functionStart; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') { braceDepth++; started = true; }
        if (char === '}') { braceDepth--; }
      }
      if (started && braceDepth === 0) {
        return i;
      }
    }
    return -1;
  }

  private static isOutParameter(lines: string[], functionStart: number, varName: string): boolean {
    const signature = GlslParser.getFullFunctionSignature(lines, functionStart);
    const paramsMatch = signature.match(/\(([^)]*)\)/);
    if (!paramsMatch || !paramsMatch[1].trim()) {
      return false;
    }

    for (const pair of paramsMatch[1].split(',').map(p => p.trim())) {
      const match = pair.match(/^(?:(in|out|inout)\s+)?(?:const\s+)?(?:vec2|vec3|vec4|float|int|bool|mat2|mat3|mat4|sampler2D)\s+(\w+)$/);
      if (match && match[1] === 'out' && match[2] === varName) {
        return true;
      }
    }

    return false;
  }
}
