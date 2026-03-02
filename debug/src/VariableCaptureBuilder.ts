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
    if (!functionInfo.name) return [];

    const varTypes = GlslParser.buildVariableTypeMap(lines, resolvedLine, functionInfo);

    // In line mode (not whole-shader), exclude `out`/`inout` parameters (e.g. fragColor)
    const outParams = new Set<string>();
    if (debugLine !== -1 && functionInfo.start >= 0) {
      const funcLine = lines[functionInfo.start];
      const paramsMatch = funcLine.match(/\(([^)]*)\)/);
      if (paramsMatch && paramsMatch[1].trim()) {
        for (const pair of paramsMatch[1].split(',').map(p => p.trim())) {
          const match = pair.match(/^(out|inout)\s+\S+\s+(\w+)/);
          if (match) outParams.add(match[2]);
        }
      }
    }

    const result: CaptureVarInfo[] = [];
    for (const [varName, varType] of varTypes) {
      if (CAPTURABLE_TYPES.has(varType) && !outParams.has(varName)) {
        result.push({ varName, varType });
        if (result.length >= 15) break;
      }
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
    gridSize: number = DEFAULT_GRID_SIZE,
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
    if (!functionInfo.name) return null;

    // Validate var is actually in scope
    const varTypes = GlslParser.buildVariableTypeMap(lines, resolvedLine, functionInfo);
    if (!varTypes.has(varName)) return null;

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
      // One-liner fallback
      const lineContent = lines[resolvedLine] || '';
      result = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  ${lineContent.trim()}\n${CodeGenerator.generateCaptureOutputForVar(varType, varName)}\n}`;
    }

    // Inject coord override: pixel mode uses uniform, grid mode scales gl_FragCoord
    if (captureCoordUniform) {
      result = VariableCaptureBuilder.injectCaptureCoord(result);
    } else {
      result = VariableCaptureBuilder.injectGridCoord(result, gridSize);
    }

    return result;
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
    const helperFunctions: string[] = [];
    for (let i = 0; i < functionInfo.start; i++) {
      helperFunctions.push(lines[i]);
    }

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
    const indent = '  ';
    const returnVar = shadowVarName || varInfo.name;
    result.push(`${indent}return ${returnVar};`);
    result.push(...closedLines.slice(originalLength));

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

    const captureOutput = CodeGenerator.generateCaptureOutputForVar(varInfo.type, 'result');
    const setupCode = setup.length > 0 ? setup.join('\n') + '\n' : '';
    const callLine = `${setupCode}  ${varInfo.type} result = ${functionInfo.name!}(${args.join(', ')});\n${captureOutput}`;

    const wrapper = [];
    wrapper.push(...helperFunctions);
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
   * Injects `fragCoord = gl_FragCoord.xy / vec2(gridSize) * iResolution.xy;`
   * at the start of mainImage body so 32×32 grid samples cover the full canvas.
   */
  private static injectGridCoord(code: string, gridSize: number): string {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/void\s+mainImage\s*\(/.test(lines[i])) {
        for (let j = i; j < lines.length && j < i + 5; j++) {
          if (lines[j].replace(/\/\/.*$/, '').includes('{')) {
            lines.splice(j + 1, 0, `  fragCoord = gl_FragCoord.xy / vec2(${gridSize}.0) * iResolution.xy;`);
            break;
          }
        }
        break;
      }
    }
    return lines.join('\n');
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
}
