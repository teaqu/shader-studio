import type { FunctionInfo, VarInfo } from './GlslParser';
import { GlslParser } from './GlslParser';

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

  static removeControlFlowKeywords(lines: string[], mainImageStart: number): string[] {
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Special handling for 'for' loops - extract initialization and run body once
      const forLoopMatch = line.match(/^\s*for\s*\(\s*(.+?)\s*;\s*.+?\s*;\s*.+?\s*\)\s*\{?\s*$/);
      if (forLoopMatch && i >= mainImageStart) {
        const initialization = forLoopMatch[1].trim();
        const indent = line.match(/^(\s*)/)?.[1] || '';
        result.push(`${indent}${initialization};  // Loop init (first iteration only)`);
        continue;
      }

      // Skip lines that are only control flow statements (if, else, while)
      const isControlFlow = /^\s*(if|else|while)\s*[\(\{]/.test(line) ||
                           /^\s*\}\s*else\s*\{?\s*$/.test(line);

      if (isControlFlow && i >= mainImageStart) {
        continue;
      }

      // Remove closing braces that would close control flow blocks
      const trimmed = line.trim();
      if (trimmed === '}' && i >= mainImageStart && i < lines.length - 1) {
        continue;
      }

      result.push(line);
    }

    return result;
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

  private static buildCallResult(
    functionName: string,
    args: string,
    varInfo: VarInfo,
    setup: string[] = []
  ): string {
    const visualization = CodeGenerator.generateReturnStatementForVar(varInfo.type, 'result');
    const setupCode = setup.length > 0 ? setup.join('\n') + '\n' : '';
    return `${setupCode}  ${varInfo.type} result = ${functionName}(${args});\n${visualization}`;
  }

  static generateFunctionCall(
    lines: string[],
    functionName: string,
    functionInfo: FunctionInfo,
    varInfo: VarInfo
  ): string {
    const callInfo = GlslParser.findFunctionCall(lines, functionName);

    if (!callInfo) {
      const params = CodeGenerator.generateDefaultParameters(lines, functionInfo);
      return CodeGenerator.buildCallResult(functionName, params.args, varInfo, params.setup);
    }

    const mainImageStart = GlslParser.findMainImageStart(lines);
    if (mainImageStart === -1) {
      return `  vec2 uv = fragCoord / iResolution.xy;\n  float result = ${functionName}(${callInfo.params});\n  fragColor = vec4(vec3(result), 1.0);`;
    }

    // Extract mainImage setup lines up to the call point
    const setupLines: string[] = [];
    for (let i = mainImageStart + 1; i < callInfo.lineIndex; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!/^\s*(if|else|for|while|}\s*else)\s*[\(\{]/.test(line) &&
          trimmed !== '}' &&
          trimmed !== '{' &&
          trimmed !== '') {
        setupLines.push(line);
      }
    }

    // Check if call parameters reference undefined variables — fall back to defaults
    const callParamNames = callInfo.params.split(',').map(p => p.trim()).filter(p => p);
    const mainImageVarTypes = GlslParser.buildVariableTypeMap(lines, callInfo.lineIndex, { name: 'mainImage', start: mainImageStart, end: -1 });

    const hasUndefinedParams = callParamNames.some(param => {
      const isVarName = /^[a-zA-Z_]\w*(\.[xyzwrgba]+)?$/.test(param);
      if (!isVarName) return false;
      const baseName = param.split('.')[0];
      return !mainImageVarTypes.has(baseName);
    });

    if (hasUndefinedParams) {
      const params = CodeGenerator.generateDefaultParameters(lines, functionInfo);
      return CodeGenerator.buildCallResult(functionName, params.args, varInfo, params.setup);
    }

    return CodeGenerator.buildCallResult(functionName, callInfo.params, varInfo, setupLines);
  }

  static wrapFunctionForDebugging(
    lines: string[],
    functionInfo: FunctionInfo,
    debugLine: number,
    varInfo: VarInfo
  ): string {
    const helperFunctions: string[] = [];
    for (let i = 0; i < functionInfo.start; i++) {
      helperFunctions.push(lines[i]);
    }

    const functionLines = [];
    for (let i = functionInfo.start; i <= debugLine; i++) {
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

      const forLoopMatch = line.match(/^\s*for\s*\(\s*(.+?)\s*;\s*.+?\s*;\s*.+?\s*\)\s*\{?\s*$/);
      if (forLoopMatch && i > functionInfo.start) {
        const initialization = forLoopMatch[1].trim();
        const indent = line.match(/^(\s*)/)?.[1] || '';
        line = `${indent}${initialization};  // Loop init (first iteration only)`;
      }

      const isControlFlow = /^\s*(if|else|while)\s*[\(\{]/.test(line) ||
                           /^\s*\}\s*else\s*\{?\s*$/.test(line);
      if (isControlFlow && i > functionInfo.start) {
        continue;
      }

      functionLines.push(line);
    }

    const indent = '  ';
    functionLines.push(`${indent}return ${varInfo.name};`);
    functionLines.push('}');

    const wrapper = [];
    wrapper.push(...helperFunctions);
    wrapper.push(...functionLines);
    wrapper.push('');
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    const call = CodeGenerator.generateFunctionCall(lines, functionInfo.name!, functionInfo, varInfo);
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
