import type { ShaderDebugState } from "./types/ShaderDebugState";

export class ShaderDebugManager {
  private state: ShaderDebugState = {
    isEnabled: false,
    currentLine: null,
    lineContent: null,
    filePath: null,
    isActive: false,
  };

  private stateCallback: ((state: ShaderDebugState) => void) | null = null;

  public setStateCallback(callback: (state: ShaderDebugState) => void): void {
    this.stateCallback = callback;
  }

  public toggleEnabled(): void {
    this.state.isEnabled = !this.state.isEnabled;
    this.updateActiveState();
    this.notifyStateChange();
  }

  public updateDebugLine(line: number, lineContent: string, filePath: string): void {
    this.state.currentLine = line;
    this.state.lineContent = lineContent;
    this.state.filePath = filePath;
    this.updateActiveState();
    this.notifyStateChange();
  }

  public getState(): ShaderDebugState {
    return { ...this.state };
  }

  private updateActiveState(): void {
    this.state.isActive = this.state.isEnabled &&
                          this.state.currentLine !== null &&
                          this.state.lineContent !== null;
  }

  private notifyStateChange(): void {
    if (this.stateCallback) {
      this.stateCallback(this.getState());
    }
  }

  /**
   * Modifies shader code to execute up to the debug line
   * Returns modified code or null if modification fails
   */
  public modifyShaderForDebugging(
    originalCode: string,
    debugLine: number,
    headerLineCount: number
  ): string | null {
    if (!this.state.isActive || !this.state.lineContent) {
      return null;
    }

    const adjustedLine = debugLine;
    const lines = originalCode.split('\n');

    // Find which function we're in
    const functionInfo = this.findEnclosingFunction(lines, adjustedLine);

    // Build variable type map from all previous lines
    const varTypes = this.buildVariableTypeMap(lines, adjustedLine);

    // Detect variable and type at this line
    const varInfo = this.detectVariableAndType(this.state.lineContent, varTypes);
    if (!varInfo) {
      return null; // Can't determine variable or type
    }


    if (functionInfo.name === 'mainImage') {
      // Inside mainImage - truncate and close
      const truncatedLines = lines.slice(0, adjustedLine + 1);

      // Remove control flow keywords (if, else, for, while) to avoid unclosed braces
      const cleanedLines = this.removeControlFlowKeywords(truncatedLines, functionInfo.start);

      const returnStatement = this.generateReturnStatementForVar(varInfo.type, varInfo.name);
      cleanedLines.push(returnStatement);
      cleanedLines.push('}');
      return cleanedLines.join('\n');
    } else if (functionInfo.name) {
      // Inside another function - extract function and create wrapper
      return this.wrapFunctionForDebugging(
        lines,
        functionInfo,
        adjustedLine,
        varInfo
      );
    } else {
      // Not in any function (one-liner) - create minimal mainImage
      return this.wrapOneLinerForDebugging(this.state.lineContent, varInfo);
    }
  }

  /**
   * Removes control flow keywords (if, else, for, while) from truncated code
   * to avoid unclosed braces and ensure clean execution
   */
  private removeControlFlowKeywords(lines: string[], mainImageStart: number): string[] {
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip lines that are only control flow statements
      // Match: if (...) {, else {, } else {, for (...) {, while (...) {
      const isControlFlow = /^\s*(if|else|for|while)\s*[\(\{]/.test(line) ||
                           /^\s*\}\s*else\s*\{?\s*$/.test(line);

      if (isControlFlow && i >= mainImageStart) {
        // Skip this line (it's a control flow statement inside mainImage)
        continue;
      }

      // Remove closing braces that would close control flow blocks
      // Keep lines that have actual code beyond just '}'
      const trimmed = line.trim();
      if (trimmed === '}' && i >= mainImageStart && i < lines.length - 1) {
        // This is likely closing an if/else/for/while - skip it
        continue;
      }

      result.push(line);
    }

    return result;
  }

  private findMainImageStart(lines: string[]): number {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('void mainImage')) {
        return i;
      }
    }
    return -1;
  }

  private findEnclosingFunction(lines: string[], lineNum: number): { name: string | null; start: number; end: number } {
    // Look backwards to find function declaration
    // We count braces backwards - starting inside a function means we'll go negative
    // Continue until we find a function declaration at depth 0 OR we've exited all scopes
    let braceDepth = 0;
    let functionStart = -1;
    let functionName: string | null = null;

    for (let i = lineNum; i >= 0; i--) {
      const line = lines[i];

      // Count braces FIRST (walking backwards, so before = outside)
      for (const char of line) {
        if (char === '{') braceDepth--;
        if (char === '}') braceDepth++;
      }

      // Look for function declaration at this depth
      const funcMatch = line.match(/(?:void|float|vec2|vec3|vec4|mat2|mat3|mat4)\s+(\w+)\s*\(/);
      if (funcMatch) {
        // Found a function - we're inside it if braceDepth is negative
        // (we've counted opening braces as we walked backwards)
        if (braceDepth < 0) {
          // We're inside this function (or nested inside it)
          functionName = funcMatch[1];
          functionStart = i;
          break;
        }
        // If brace is on same line
        if (braceDepth === 0 && line.includes('{')) {
          functionName = funcMatch[1];
          functionStart = i;
          break;
        }
        // If brace is on next line
        if (braceDepth === 0 && i + 1 < lines.length && lines[i + 1].trim() === '{') {
          functionName = funcMatch[1];
          functionStart = i;
          break;
        }
      }

      // If we've gone too far out (exited multiple scopes), stop
      if (braceDepth > 0) {
        break;
      }
    }

    // Find function end (closing brace)
    let functionEnd = -1;
    if (functionStart !== -1) {
      braceDepth = 0;
      let foundStart = false;
      for (let i = functionStart; i < lines.length; i++) {
        for (const char of lines[i]) {
          if (char === '{') {
            braceDepth++;
            foundStart = true;
          }
          if (char === '}') {
            braceDepth--;
            if (foundStart && braceDepth === 0) {
              functionEnd = i;
              break;
            }
          }
        }
        if (functionEnd !== -1) break;
      }
    }

    return {
      name: functionName,
      start: functionStart,
      end: functionEnd
    };
  }

  private wrapFunctionForDebugging(
    lines: string[],
    functionInfo: { name: string | null; start: number; end: number },
    debugLine: number,
    varInfo: { name: string; type: string }
  ): string {
    // Extract all helper functions before the current function
    const helperFunctions: string[] = [];
    for (let i = 0; i < functionInfo.start; i++) {
      helperFunctions.push(lines[i]);
    }

    // Extract the function up to the debug line
    const functionLines = [];
    for (let i = functionInfo.start; i <= debugLine; i++) {
      functionLines.push(lines[i]);
    }

    // Add return statement
    const returnStatement = this.generateReturnStatementForVar(varInfo.type, varInfo.name);
    functionLines.push(returnStatement);
    functionLines.push('}');

    // Create wrapper mainImage that calls this function
    const wrapper = [];
    wrapper.push(...helperFunctions);
    wrapper.push(...functionLines);
    wrapper.push('');
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    // Try to call the function with sensible default values
    const call = this.generateFunctionCall(functionInfo.name!, varInfo);
    wrapper.push(call);
    wrapper.push('}');

    return wrapper.join('\n');
  }

  private wrapOneLinerForDebugging(
    lineContent: string,
    varInfo: { name: string; type: string }
  ): string {
    const wrapper = [];
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    wrapper.push(`  ${lineContent.trim()}`);
    wrapper.push(`  ${this.generateReturnStatementForVar(varInfo.type, varInfo.name)}`);
    wrapper.push('}');
    return wrapper.join('\n');
  }

  private generateFunctionCall(functionName: string, varInfo: { name: string; type: string }): string {
    // Generate a call with sensible defaults
    // This is a heuristic - might not work for all functions
    return `  float result = ${functionName}(fragCoord / iResolution.xy, iTime);\n  fragColor = vec4(vec3(result), 1.0);`;
  }

  private buildVariableTypeMap(lines: string[], upToLine: number): Map<string, string> {
    const varTypes = new Map<string, string>();

    // Scan all lines up to and including the debug line
    for (let i = 0; i <= upToLine && i < lines.length; i++) {
      const line = lines[i];

      // Match variable declarations: type name = ...
      const declPatterns = [
        { pattern: /\s*(vec4)\s+(\w+)\s*[=;]/, type: 'vec4' },
        { pattern: /\s*(vec3)\s+(\w+)\s*[=;]/, type: 'vec3' },
        { pattern: /\s*(vec2)\s+(\w+)\s*[=;]/, type: 'vec2' },
        { pattern: /\s*(float)\s+(\w+)\s*[=;]/, type: 'float' },
        { pattern: /\s*(mat2)\s+(\w+)\s*[=;]/, type: 'mat2' },
        { pattern: /\s*(mat3)\s+(\w+)\s*[=;]/, type: 'mat3' },
        { pattern: /\s*(mat4)\s+(\w+)\s*[=;]/, type: 'mat4' },
      ];

      for (const { pattern, type } of declPatterns) {
        const match = line.match(pattern);
        if (match && match[2]) {
          varTypes.set(match[2], type);
        }
      }
    }

    return varTypes;
  }

  private detectVariableAndType(lineContent: string, varTypes: Map<string, string>): { name: string; type: string } | null {
    // First, try to match a variable declaration on this line
    const declPatterns = [
      { pattern: /\s*(vec4)\s+(\w+)\s*=/, type: 'vec4' },
      { pattern: /\s*(vec3)\s+(\w+)\s*=/, type: 'vec3' },
      { pattern: /\s*(vec2)\s+(\w+)\s*=/, type: 'vec2' },
      { pattern: /\s*(float)\s+(\w+)\s*=/, type: 'float' },
      { pattern: /\s*(mat2)\s+(\w+)\s*=/, type: 'mat2' },
      { pattern: /\s*(mat3)\s+(\w+)\s*=/, type: 'mat3' },
      { pattern: /\s*(mat4)\s+(\w+)\s*=/, type: 'mat4' },
    ];

    for (const { pattern, type } of declPatterns) {
      const match = lineContent.match(pattern);
      if (match && match[2]) {
        return { name: match[2], type };
      }
    }

    // If not a declaration, try to match a reassignment or compound assignment
    const assignPatterns = [
      /(\w+)\s*\*=/, // uv *= rot
      /(\w+)\s*\+=/, // uv += offset
      /(\w+)\s*-=/, // uv -= offset
      /(\w+)\s*\/=/, // uv /= scale
      /(\w+)\s*=\s*(?!.*\b(vec4|vec3|vec2|float|mat2|mat3|mat4)\b)/, // uv = ... (not a declaration)
    ];

    for (const pattern of assignPatterns) {
      const match = lineContent.match(pattern);
      if (match && match[1]) {
        const varName = match[1];
        const varType = varTypes.get(varName);
        if (varType) {
          return { name: varName, type: varType };
        }
      }
    }

    // Try to match member access assignments: uv.x *= ..., color.r = ..., etc.
    const memberAccessPatterns = [
      /(\w+)\.[xyzw]\s*\*=/, // uv.x *= value
      /(\w+)\.[xyzw]\s*\+=/, // uv.x += value
      /(\w+)\.[xyzw]\s*-=/, // uv.x -= value
      /(\w+)\.[xyzw]\s*\/=/, // uv.x /= value
      /(\w+)\.[xyzw]\s*=/, // uv.x = value
      /(\w+)\.[rgba]\s*\*=/, // color.r *= value
      /(\w+)\.[rgba]\s*\+=/, // color.r += value
      /(\w+)\.[rgba]\s*-=/, // color.r -= value
      /(\w+)\.[rgba]\s*\/=/, // color.r /= value
      /(\w+)\.[rgba]\s*=/, // color.r = value
      /(\w+)\.[xy]+\s*\*=/, // uv.xy *= value (swizzle)
      /(\w+)\.[xy]+\s*\+=/, // uv.xy += value
      /(\w+)\.[xy]+\s*=/, // uv.xy = value
    ];

    for (const pattern of memberAccessPatterns) {
      const match = lineContent.match(pattern);
      if (match && match[1]) {
        const varName = match[1];
        const varType = varTypes.get(varName);
        if (varType) {
          return { name: varName, type: varType };
        }
      }
    }

    return null;
  }

  private generateReturnStatementForVar(varType: string, varName: string): string {
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

  private detectVariableType(lineContent: string): string | null {
    // Match patterns like: float x = ..., vec2 uv = ..., vec3 color = ...
    const patterns = [
      /\s*vec4\s+(\w+)\s*=/,
      /\s*vec3\s+(\w+)\s*=/,
      /\s*vec2\s+(\w+)\s*=/,
      /\s*float\s+(\w+)\s*=/,
    ];

    for (const pattern of patterns) {
      const match = lineContent.match(pattern);
      if (match) {
        const fullMatch = match[0];
        if (fullMatch.includes('vec4')) return 'vec4';
        if (fullMatch.includes('vec3')) return 'vec3';
        if (fullMatch.includes('vec2')) return 'vec2';
        if (fullMatch.includes('float')) return 'float';
      }
    }

    return null;
  }

  private generateReturnStatement(varType: string, lineContent: string): string {
    // Extract variable name
    const varNameMatch = lineContent.match(/\s*(vec4|vec3|vec2|float)\s+(\w+)/);
    if (!varNameMatch) {
      return '  fragColor = vec4(1.0, 0.0, 1.0, 1.0); // Debug: error';
    }

    const varName = varNameMatch[2];

    switch (varType) {
      case 'float':
        return `  fragColor = vec4(vec3(${varName}), 1.0); // Debug: visualize float as grayscale`;
      case 'vec2':
        return `  fragColor = vec4(${varName}, 0.0, 1.0); // Debug: visualize vec2 (RG channels)`;
      case 'vec3':
        return `  fragColor = vec4(${varName}, 1.0); // Debug: visualize vec3 as RGB`;
      case 'vec4':
        return `  fragColor = ${varName}; // Debug: visualize vec4 directly`;
      default:
        return '  fragColor = vec4(1.0, 0.0, 1.0, 1.0); // Debug: unknown type';
    }
  }
}
