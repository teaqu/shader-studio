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
      return GlslParser.getGlobalVariables(lines, resolvedLine)
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
   * Generate one capture shader that can output any mainImage variable by setting
   * uniform int _dbgVarIndex before drawing.
   *
   * Returns null only when the current variable set cannot be represented as
   * a single selector shader for the current scope.
   */
  static generateMultiCaptureShader(
    code: string,
    debugLine: number,
    vars: CaptureVarInfo[],
    loopMaxIterations: Map<number, number>,
    _customParameters: Map<number, string>,
    captureCoordUniform: boolean,
    gridWidth: number = DEFAULT_GRID_SIZE,
    gridHeight: number = DEFAULT_GRID_SIZE,
  ): string | null {
    if (vars.length === 0) return null;

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

    if (functionInfo.end >= 0 && resolvedLine === functionInfo.end) {
      resolvedLine = functionInfo.end - 1;
    }

    if (!functionInfo.name) {
      const globalVars = GlslParser.getGlobalVariables(lines, resolvedLine);
      for (const captureVar of vars) {
        if (VariableCaptureBuilder.isExternalCaptureVar(captureVar)) {
          continue;
        }
        const isGlobal = globalVars.some(
          globalVar => globalVar.name === captureVar.varName && globalVar.type === captureVar.varType,
        );
        if (!isGlobal) return null;
      }

      let shader = VariableCaptureBuilder.wrapGlobalScopeForMultiCapture(lines, vars);
      if (captureCoordUniform) {
        shader = VariableCaptureBuilder.injectCaptureCoord(shader);
      } else {
        shader = VariableCaptureBuilder.injectGridCoord(shader, gridWidth, gridHeight);
      }
      return shader;
    }

    if (functionInfo.name !== 'mainImage') {
      let shader = VariableCaptureBuilder.wrapFunctionForMultiCapture(
        lines,
        functionInfo,
        resolvedLine,
        vars,
        loopMaxIterations,
        _customParameters,
      );
      if (shader === null) return null;
      if (captureCoordUniform) {
        shader = VariableCaptureBuilder.injectCaptureCoord(shader);
      } else {
        shader = VariableCaptureBuilder.injectGridCoord(shader, gridWidth, gridHeight);
      }
      return shader;
    }

    const varTypes = GlslParser.buildVariableTypeMap(lines, resolvedLine, functionInfo);
    const globalVars = GlslParser.getUsedGlobalVariables(lines, functionInfo);
    for (const captureVar of vars) {
      if (VariableCaptureBuilder.isExternalCaptureVar(captureVar)) {
        continue;
      }
      const isLocal = varTypes.get(captureVar.varName) === captureVar.varType;
      const isGlobal = globalVars.some(
        globalVar => globalVar.name === captureVar.varName && globalVar.type === captureVar.varType,
      );
      if (!isLocal && !isGlobal) return null;
    }

    let truncationEnd = CodeGenerator.extendForMultiLine(lines, resolvedLine);
    truncationEnd = VariableCaptureBuilder.extendToFunctionBodyLevel(lines, functionInfo.start, truncationEnd);
    truncationEnd = CodeGenerator.extendForPreprocessorConditionals(lines, functionInfo.start, truncationEnd);

    const truncatedLines = lines.slice(0, truncationEnd + 1);
    const { lines: shadowedLines, vars: outputVars } = VariableCaptureBuilder.insertSelectorShadows(
      truncatedLines,
      lines,
      functionInfo.start,
      truncationEnd,
      vars,
    );
    const withCappedLoops = CodeGenerator.capLoopIterations(shadowedLines, functionInfo.start, loopMaxIterations);
    const closedLines = CodeGenerator.closeOpenBraces(withCappedLoops, functionInfo.start);
    const originalLength = withCappedLoops.length;
    const result = closedLines.slice(0, originalLength);
    result.push(...VariableCaptureBuilder.generateSelectorCaptureOutput(outputVars));
    result.push(...closedLines.slice(originalLength));

    let shader = `uniform int _dbgVarIndex;\n${result.join('\n')}`;
    if (captureCoordUniform) {
      shader = VariableCaptureBuilder.injectCaptureCoord(shader);
    } else {
      shader = VariableCaptureBuilder.injectGridCoord(shader, gridWidth, gridHeight);
    }
    return shader;
  }

  private static wrapGlobalScopeForMultiCapture(
    lines: string[],
    vars: CaptureVarInfo[],
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

    return [
      'uniform int _dbgVarIndex;',
      ...preservedLines,
      '',
      'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
      ...VariableCaptureBuilder.generateSelectorCaptureOutput(vars),
      '}',
    ].join('\n');
  }

  private static wrapFunctionForMultiCapture(
    lines: string[],
    functionInfo: import('./GlslParser').FunctionInfo,
    debugLine: number,
    vars: CaptureVarInfo[],
    loopMaxIterations: Map<number, number>,
    customParameters: Map<number, string>,
  ): string | null {
    const returnType = VariableCaptureBuilder.getFunctionReturnType(lines, functionInfo.start);
    if (returnType === null) return null;

    const varTypes = GlslParser.buildVariableTypeMap(lines, debugLine, functionInfo);
    const globalVars = GlslParser.getUsedGlobalVariables(lines, functionInfo);
    for (const captureVar of vars) {
      if (VariableCaptureBuilder.isExternalCaptureVar(captureVar)) {
        continue;
      }
      const isReturnCapture = captureVar.varName === '_dbgReturn';
      const isLocal = varTypes.get(captureVar.varName) === captureVar.varType;
      const isGlobal = globalVars.some(
        globalVar => globalVar.name === captureVar.varName && globalVar.type === captureVar.varType,
      );
      if (!isReturnCapture && !isLocal && !isGlobal) return null;
    }

    const debugFunctionName = `_dbg_${functionInfo.name}`;
    const preservedSource = VariableCaptureBuilder.splitSourceForHelperWrapper(lines);
    const containingLoops = ShaderDebugger.extractLoops(lines, functionInfo.start, debugLine);

    let truncationEnd: number;
    if (containingLoops.length > 0) {
      truncationEnd = containingLoops[0].endLine;
    } else {
      truncationEnd = CodeGenerator.extendForMultiLine(lines, debugLine);
    }
    truncationEnd = CodeGenerator.extendForPreprocessorConditionals(lines, functionInfo.start, truncationEnd);

    const returnRange = CodeGenerator.findReturnRange(lines, debugLine, truncationEnd);
    const returnRanges = CodeGenerator.findReturnRanges(lines, functionInfo.start, truncationEnd);
    const returnRangeMap = new Map(returnRanges.map(range => [range.start, range]));
    const returnCaptureIndexes = vars
      .map((captureVar, index) => captureVar.varName === '_dbgReturn' ? index : -1)
      .filter(index => index >= 0);

    const functionLines: string[] = [];
    for (let i = functionInfo.start; i <= truncationEnd; i++) {
      let line = lines[i];

      if (i === functionInfo.start) {
        line = VariableCaptureBuilder.renameFunctionSignature(
          line,
          functionInfo.name!,
          debugFunctionName,
        );
      }

      const currentReturnRange = returnRangeMap.get(i);
      if (currentReturnRange) {
        const indent = line.match(/^\s*/)?.[0] || '  ';
        const isTargetReturn =
          returnRange !== null &&
          currentReturnRange.start === returnRange.start &&
          currentReturnRange.end === returnRange.end;

        if (isTargetReturn && returnCaptureIndexes.length > 0) {
          const fullReturn = lines.slice(currentReturnRange.start, currentReturnRange.end + 1).join(' ');
          const returnMatch = fullReturn.match(/^\s*return\s+(.+);/);
          if (returnMatch) {
            for (const index of returnCaptureIndexes) {
              functionLines.push(`${indent}_dbgCaptured${index} = ${returnMatch[1]};`);
            }
          }
        } else {
          functionLines.push(`${indent}// Debug: stripped return`);
        }

        i = currentReturnRange.end;
        continue;
      }

      functionLines.push(line);
    }

    const relativeVars = vars.map(captureVar => ({
      ...captureVar,
      declarationLine: captureVar.declarationLine >= functionInfo.start
        ? captureVar.declarationLine - functionInfo.start
        : captureVar.declarationLine,
    }));
    const varsNeedingEndCapture = relativeVars.filter(captureVar => captureVar.varName !== '_dbgReturn');
    const { lines: shadowedLines, vars: outputVars } = VariableCaptureBuilder.insertSelectorShadows(
      functionLines,
      functionLines,
      0,
      functionLines.length - 1,
      varsNeedingEndCapture,
    );

    const cappedLines = CodeGenerator.capLoopIterations(shadowedLines, 0, loopMaxIterations);
    const closedLines = CodeGenerator.closeOpenBraces(cappedLines, 0);
    const originalLength = cappedLines.length;
    const result = closedLines.slice(0, originalLength);
    let outputVarIndex = 0;
    for (let index = 0; index < vars.length; index++) {
      if (vars[index].varName === '_dbgReturn') continue;
      const outputVar = outputVars[outputVarIndex++];
      result.push(`  _dbgCaptured${index} = ${outputVar.varName};`);
    }
    const defaultReturn = VariableCaptureBuilder.generateDefaultReturn(returnType);
    if (defaultReturn) {
      result.push(`  ${defaultReturn}`);
    }
    result.push(...closedLines.slice(originalLength));

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

    const wrapper: string[] = [];
    wrapper.push('uniform int _dbgVarIndex;');
    wrapper.push(...preservedSource);
    wrapper.push('');
    for (let index = 0; index < vars.length; index++) {
      wrapper.push(`${vars[index].varType} _dbgCaptured${index};`);
    }
    wrapper.push(...result);
    wrapper.push('');
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    if (setup.length > 0) {
      wrapper.push(...setup);
    }
    wrapper.push(`  ${debugFunctionName}(${args.join(', ')});`);
    wrapper.push(...VariableCaptureBuilder.generateSelectorCaptureOutput(vars.map((captureVar, index) => ({
      ...captureVar,
      varName: `_dbgCaptured${index}`,
    }))));
    wrapper.push('}');

    return wrapper.join('\n');
  }

  private static isExternalCaptureVar(captureVar: CaptureVarInfo): boolean {
    return captureVar.declarationLine < 0 && CAPTURABLE_TYPES.has(captureVar.varType);
  }

  private static insertSelectorShadows(
    truncatedLines: string[],
    originalLines: string[],
    functionStart: number,
    truncationEnd: number,
    vars: CaptureVarInfo[],
  ): { lines: string[]; vars: CaptureVarInfo[] } {
    const shadowSpecs = vars
      .map((captureVar, index) => {
        const loop = VariableCaptureBuilder.findContainingLoopClosedBeforeOutput(
          originalLines,
          functionStart,
          captureVar.declarationLine,
          truncationEnd,
        );
        if (!loop) return null;
        return {
          originalIndex: index,
          originalName: captureVar.varName,
          shadowName: `_dbgShadow${index}`,
          type: captureVar.varType,
          declarationLine: captureVar.declarationLine,
          loopLine: loop.lineNumber,
          insertionLine: VariableCaptureBuilder.findSelectorShadowAssignmentLine(
            originalLines,
            captureVar.declarationLine,
            captureVar.varName,
            loop.lineNumber,
          ),
        };
      })
      .filter((spec): spec is NonNullable<typeof spec> => spec !== null);

    if (shadowSpecs.length === 0) {
      return { lines: truncatedLines, vars };
    }

    const specsByLoopLine = new Map<number, typeof shadowSpecs>();
    const specsByInsertionLine = new Map<number, typeof shadowSpecs>();
    for (const spec of shadowSpecs) {
      const loopSpecs = specsByLoopLine.get(spec.loopLine) ?? [];
      loopSpecs.push(spec);
      specsByLoopLine.set(spec.loopLine, loopSpecs);

      const insertionSpecs = specsByInsertionLine.get(spec.insertionLine) ?? [];
      insertionSpecs.push(spec);
      specsByInsertionLine.set(spec.insertionLine, insertionSpecs);
    }

    const result: string[] = [];
    for (let lineIndex = 0; lineIndex < truncatedLines.length; lineIndex++) {
      const declarations = specsByLoopLine.get(lineIndex);
      if (declarations) {
        const indent = truncatedLines[lineIndex].match(/^(\s*)/)?.[1] ?? '  ';
        for (const spec of declarations) {
          result.push(`${indent}${spec.type} ${spec.shadowName};`);
        }
      }

      result.push(truncatedLines[lineIndex]);

      const assignments = specsByInsertionLine.get(lineIndex);
      if (assignments) {
        const indent = `${truncatedLines[lineIndex].match(/^(\s*)/)?.[1] ?? '  '}  `;
        for (const spec of assignments) {
          result.push(`${indent}${spec.shadowName} = ${spec.originalName};`);
        }
      }
    }

    const outputVars = vars.map((captureVar, index) => {
      const shadow = shadowSpecs.find(spec => spec.originalIndex === index);
      return shadow
        ? { ...captureVar, varName: shadow.shadowName }
        : captureVar;
    });

    return { lines: result, vars: outputVars };
  }

  private static findContainingLoopClosedBeforeOutput(
    lines: string[],
    functionStart: number,
    declarationLine: number,
    truncationEnd: number,
  ): { lineNumber: number; endLine: number } | null {
    if (declarationLine < 0) return null;
    const containingLoops = ShaderDebugger.extractLoops(lines, functionStart, declarationLine)
      .filter(loop => loop.endLine <= truncationEnd);
    if (containingLoops.length === 0) {
      const headerLoops = ShaderDebugger.extractLoops(lines, functionStart, declarationLine + 1)
        .filter(loop => loop.lineNumber === declarationLine && loop.endLine <= truncationEnd);
      return headerLoops[0] ?? null;
    }
    return containingLoops[0];
  }

  private static findSelectorShadowAssignmentLine(
    lines: string[],
    declarationLine: number,
    varName: string,
    loopLine: number,
  ): number {
    if (declarationLine === loopLine && new RegExp(`\\b${varName}\\b`).test(lines[loopLine] ?? '')) {
      for (let i = loopLine; i < lines.length; i++) {
        if (lines[i].replace(/\/\/.*$/, '').includes('{')) {
          return i;
        }
      }
      return loopLine;
    }

    return CodeGenerator.extendForMultiLine(lines, declarationLine);
  }

  private static generateSelectorCaptureOutput(vars: CaptureVarInfo[]): string[] {
    const lines: string[] = [];
    for (let index = 0; index < vars.length; index++) {
      const captureVar = vars[index];
      lines.push(`  if (_dbgVarIndex == ${index}) {`);
      lines.push(...CodeGenerator.generateCaptureOutputForVar(captureVar.varType, captureVar.varName)
        .split('\n')
        .map(line => `  ${line}`));
      lines.push('    return;');
      lines.push('  }');
    }
    lines.push('  fragColor = vec4(0.0);');
    return lines;
  }

  private static extendToFunctionBodyLevel(
    lines: string[],
    functionStart: number,
    truncationEnd: number,
  ): number {
    let depth = 0;
    for (let i = functionStart; i <= truncationEnd; i++) {
      const stripped = lines[i].replace(/\/\/.*$/, '');
      for (const char of stripped) {
        if (char === '{') depth++;
        if (char === '}') depth--;
      }
    }

    if (depth <= 1) return truncationEnd;

    for (let i = truncationEnd + 1; i < lines.length; i++) {
      const stripped = lines[i].replace(/\/\/.*$/, '');
      for (const char of stripped) {
        if (char === '{') depth++;
        if (char === '}') depth--;
      }
      if (depth <= 1) return i;
    }

    return truncationEnd;
  }

  private static splitSourceForHelperWrapper(lines: string[]): string[] {
    const mainImageStart = VariableCaptureBuilder.findMainImageStart(lines);
    const mainImageEnd = mainImageStart >= 0
      ? VariableCaptureBuilder.findFunctionEnd(lines, mainImageStart)
      : -1;

    if (mainImageStart === -1 || mainImageEnd < mainImageStart) {
      return [...lines];
    }

    return [
      ...lines.slice(0, mainImageStart),
      ...lines.slice(mainImageEnd + 1),
    ];
  }

  private static getFunctionReturnType(lines: string[], functionStart: number): string | null {
    const signature = GlslParser.getFullFunctionSignature(lines, functionStart);
    const match = signature.match(/^\s*([A-Za-z_]\w*)\s+\w+\s*\(/);
    return match?.[1] ?? null;
  }

  private static generateDefaultReturn(returnType: string): string | null {
    switch (returnType) {
      case 'void':
        return null;
      case 'float':
        return 'return 0.0;';
      case 'vec2':
        return 'return vec2(0.0);';
      case 'vec3':
        return 'return vec3(0.0);';
      case 'vec4':
        return 'return vec4(0.0);';
      case 'int':
        return 'return 0;';
      case 'bool':
        return 'return false;';
      case 'mat2':
        return 'return mat2(0.0);';
      case 'mat3':
        return 'return mat3(0.0);';
      case 'mat4':
        return 'return mat4(0.0);';
      default:
        return null;
    }
  }

  /**
   * Injects `uniform vec2 _dbgCaptureCoord;` and
   * `vec2 fragCoord = _dbgCaptureCoord;` at the start of mainImage body.
   */
  private static injectCaptureCoord(code: string): string {
    const lines = VariableCaptureBuilder.remapBuiltinFragCoord(code).split('\n');

    // Prepend uniform declaration before the first line
    const uniformDecl = 'uniform vec2 _dbgCaptureCoord;';

    // Find mainImage and inject fragCoord override at start of body
    for (let i = 0; i < lines.length; i++) {
      if (/void\s+mainImage\s*\(/.test(lines[i])) {
        // Find the opening brace
        for (let j = i; j < lines.length && j < i + 5; j++) {
          if (lines[j].includes('{')) {
            lines.splice(
              j + 1,
              0,
              '  vec2 _dbgRemappedFragCoord = _dbgCaptureCoord;',
              '  fragCoord = _dbgRemappedFragCoord;',
              '  vec4 _dbgGlFragCoord = vec4(_dbgRemappedFragCoord, 0.0, 1.0);',
            );
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
    const lines = VariableCaptureBuilder.remapBuiltinFragCoord(code).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/void\s+mainImage\s*\(/.test(lines[i])) {
        for (let j = i; j < lines.length && j < i + 5; j++) {
          if (lines[j].replace(/\/\/.*$/, '').includes('{')) {
            lines.splice(
              j + 1,
              0,
              `  vec2 _dbgRemappedFragCoord = gl_FragCoord.xy / vec2(${gridWidth}.0, ${gridHeight}.0) * iResolution.xy;`,
              '  fragCoord = _dbgRemappedFragCoord;',
              '  vec4 _dbgGlFragCoord = vec4(_dbgRemappedFragCoord, 0.0, 1.0);',
            );
            break;
          }
        }
        break;
      }
    }
    return lines.join('\n');
  }

  private static remapBuiltinFragCoord(code: string): string {
    return code.replace(/\bgl_FragCoord\b/g, '_dbgGlFragCoord');
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

}
