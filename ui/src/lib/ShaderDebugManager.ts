import type { ShaderDebugState } from "./types/ShaderDebugState";

export class ShaderDebugManager {
  private state: ShaderDebugState = {
    isEnabled: false,
    currentLine: null,
    lineContent: null,
    filePath: null,
    isActive: false,
    lastStatus: 'idle',
    lastError: null,
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

  private setDebugStatus(status: 'success' | 'failed' | 'idle', error: string | null = null): void {
    this.state.lastStatus = status;
    this.state.lastError = error;
    this.notifyStateChange();
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
    console.log('[ShaderDebug] === MODIFY SHADER ===');
    console.log('[ShaderDebug] Line:', debugLine, '|', this.state.lineContent);

    if (!this.state.isActive || !this.state.lineContent) {
      console.log('[ShaderDebug] ❌ Not active or no line content');
      return null;
    }

    const adjustedLine = debugLine;
    const lines = originalCode.split('\n');

    // Find which function we're in
    const functionInfo = this.findEnclosingFunction(lines, adjustedLine);
    console.log('[ShaderDebug] Function:', functionInfo.name || 'none');

    // Build variable type map from all previous lines AND function parameters
    const varTypes = this.buildVariableTypeMap(lines, adjustedLine, functionInfo);

    // Extract function return type if we're in a function
    let functionReturnType: string | undefined;
    if (functionInfo.name && functionInfo.start >= 0) {
      const funcLine = lines[functionInfo.start];
      const returnTypeMatch = funcLine.match(/^\s*(void|float|vec2|vec3|vec4|mat2|mat3|mat4)\s+\w+\s*\(/);
      if (returnTypeMatch) {
        functionReturnType = returnTypeMatch[1];
      }
    }

    // Detect variable and type at this line
    const varInfo = this.detectVariableAndType(this.state.lineContent, varTypes, functionReturnType);
    if (!varInfo) {
      console.log('[ShaderDebug] ❌ Could not detect variable/type');
      this.setDebugStatus('failed', 'Could not detect variable or type from line');
      return null; // Can't determine variable or type
    }
    console.log('[ShaderDebug] ✓ Detected:', varInfo.name, `(${varInfo.type})`);




    if (functionInfo.name === 'mainImage') {
      // Inside mainImage - truncate and close
      console.log('[ShaderDebug] Path: mainImage truncation');
      const truncatedLines = lines.slice(0, adjustedLine + 1);

      // Remove control flow keywords (if, else, for, while) to avoid unclosed braces
      const cleanedLines = this.removeControlFlowKeywords(truncatedLines, functionInfo.start);

      const returnStatement = this.generateReturnStatementForVar(varInfo.type, varInfo.name);
      cleanedLines.push(returnStatement);
      cleanedLines.push('}');
      const result = cleanedLines.join('\n');
      this.setDebugStatus('success');
      console.log('[ShaderDebug] ✅ Success - Modified shader:\n', result);
      return result;
    } else if (functionInfo.name) {
      // Inside another function - extract function and create wrapper
      console.log('[ShaderDebug] Path: helper function wrapper');
      const result = this.wrapFunctionForDebugging(
        lines,
        functionInfo,
        adjustedLine,
        varInfo
      );
      this.setDebugStatus('success');
      console.log('[ShaderDebug] ✅ Success - Modified shader:\n', result);
      return result;
    } else {
      // Not in any function (one-liner) - create minimal mainImage
      console.log('[ShaderDebug] Path: one-liner wrapper');
      const result = this.wrapOneLinerForDebugging(this.state.lineContent, varInfo);
      this.setDebugStatus('success');
      console.log('[ShaderDebug] ✅ Success - Modified shader:\n', result);
      return result;
    }
  }

  /**
   * Removes control flow keywords (if, else, for, while) from truncated code
   * to avoid unclosed braces and ensure clean execution.
   * For loops: extracts initialization and executes body once.
   */
  private removeControlFlowKeywords(lines: string[], mainImageStart: number): string[] {
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Special handling for 'for' loops - extract initialization and run body once
      const forLoopMatch = line.match(/^\s*for\s*\(\s*(.+?)\s*;\s*.+?\s*;\s*.+?\s*\)\s*\{?\s*$/);
      if (forLoopMatch && i >= mainImageStart) {
        // Extract initialization (e.g., "int i = 0" from "for (int i = 0; i < 10; i++)")
        const initialization = forLoopMatch[1].trim();
        const indent = line.match(/^(\s*)/)?.[1] || '';
        result.push(`${indent}${initialization};  // Loop init (first iteration only)`);
        continue;
      }

      // Skip lines that are only control flow statements (if, else, while)
      // Match: if (...) {, else {, } else {, while (...) {
      const isControlFlow = /^\s*(if|else|while)\s*[\(\{]/.test(line) ||
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
      let line = lines[i];

      // If this is the function signature line, update return type to match actual debug type
      if (i === functionInfo.start) {
        // Replace declared return type with actual type from debug line
        line = line.replace(
          /^\s*(void|float|vec2|vec3|vec4|mat2|mat3|mat4)(\s+\w+\s*\()/,
          `${varInfo.type}$2`
        );
      }

      // If this is the debug line and it's a return statement, convert it to a variable assignment
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

    // Add return statement for the debug value (don't visualize inside the function!)
    const indent = '  ';
    functionLines.push(`${indent}return ${varInfo.name};`);
    functionLines.push('}');

    // Create wrapper mainImage that calls this function
    const wrapper = [];
    wrapper.push(...helperFunctions);
    wrapper.push(...functionLines);
    wrapper.push('');
    wrapper.push('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    // Call the function with actual parameters from mainImage
    const call = this.generateFunctionCall(lines, functionInfo.name!, functionInfo, varInfo);
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

  private findFunctionCall(lines: string[], functionName: string): { params: string; lineIndex: number } | null {
    // Search for function calls in the code (not declarations)
    const callPattern = new RegExp(`${functionName}\\s*\\(([^)]*)\\)`, 'i');
    // Pattern to detect function declarations (has return type before function name)
    const declPattern = new RegExp(`^\\s*(void|float|vec2|vec3|vec4|mat2|mat3|mat4)\\s+${functionName}\\s*\\(`, 'i');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip function declarations
      if (declPattern.test(line)) {
        continue;
      }

      // Look for function calls
      const match = line.match(callPattern);
      if (match) {
        return {
          params: match[1].trim(),
          lineIndex: i
        };
      }
    }

    return null;
  }

  /**
   * Parse function signature and generate default parameters
   */
  private generateDefaultParameters(
    lines: string[],
    functionInfo: { name: string | null; start: number; end: number }
  ): { args: string; setup: string[] } {
    const setup: string[] = [];
    const args: string[] = [];

    // Get function signature
    const funcLine = lines[functionInfo.start];

    // Match function parameters: type name, type name, ...
    // Pattern: (type name, type name, ...)
    const paramsMatch = funcLine.match(/\(([^)]*)\)/);

    if (!paramsMatch || !paramsMatch[1].trim()) {
      // No parameters
      return { args: '', setup: [] };
    }

    const paramsStr = paramsMatch[1];

    // Split by comma, but be careful with nested types like sampler2D
    const paramPairs = paramsStr.split(',').map(p => p.trim());

    for (const pair of paramPairs) {
      // Match: type name (e.g., "vec2 st", "float radius")
      const match = pair.match(/^\s*(vec2|vec3|vec4|float|int|bool|mat2|mat3|mat4|sampler2D)\s+(\w+)\s*$/);

      if (match) {
        const type = match[1];

        switch (type) {
          case 'vec2':
            // Use uv for vec2 parameters
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

  private generateFunctionCall(
    lines: string[],
    functionName: string,
    functionInfo: { name: string | null; start: number; end: number },
    varInfo: { name: string; type: string }
  ): string {
    // Find where this function is called
    const callInfo = this.findFunctionCall(lines, functionName);

    if (!callInfo) {
      // Function not called - generate default parameters based on function signature
      const params = this.generateDefaultParameters(lines, functionInfo);
      const resultType = varInfo.type;
      const resultVisualization = this.generateReturnStatementForVar(resultType, 'result');

      // Generate setup code (like uv declaration) if needed by parameters
      const setupCode = params.setup.length > 0 ? params.setup.join('\n') + '\n' : '';

      return `${setupCode}  ${resultType} result = ${functionName}(${params.args});\n${resultVisualization}`;
    }

    // Build code that executes mainImage up to the call point
    // This ensures all variables used in the call parameters have values
    const mainImageStart = this.findMainImageStart(lines);
    if (mainImageStart === -1) {
      // No mainImage found, use defaults
      return `  vec2 uv = fragCoord / iResolution.xy;\n  float result = ${functionName}(${callInfo.params});\n  fragColor = vec4(vec3(result), 1.0);`;
    }

    // Execute mainImage up to (but not including) the line with the function call
    const setupLines: string[] = [];
    for (let i = mainImageStart + 1; i < callInfo.lineIndex; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      // Skip control flow, braces, and empty lines
      if (!/^\s*(if|else|for|while|}\s*else)\s*[\(\{]/.test(line) &&
          trimmed !== '}' &&
          trimmed !== '{' &&
          trimmed !== '') {
        setupLines.push(line);
      }
    }

    // Check if call parameters reference undefined variables
    // If so, fall back to default parameters
    const callParamNames = callInfo.params.split(',').map(p => p.trim()).filter(p => p);
    const mainImageVarTypes = this.buildVariableTypeMap(lines, callInfo.lineIndex, { name: 'mainImage', start: mainImageStart, end: -1 });

    const hasUndefinedParams = callParamNames.some(param => {
      // Check if param is a variable name (not a literal like 0.5 or vec2(1.0))
      const isVarName = /^[a-zA-Z_]\w*(\.[xyzwrgba]+)?$/.test(param);
      if (!isVarName) return false; // Literals are fine

      // Extract base variable name (e.g., "uv" from "uv.x")
      const baseName = param.split('.')[0];
      return !mainImageVarTypes.has(baseName);
    });

    if (hasUndefinedParams) {
      // Call uses undefined parameters - fall back to defaults
      const params = this.generateDefaultParameters(lines, functionInfo);
      const resultType = varInfo.type;
      const resultVisualization = this.generateReturnStatementForVar(resultType, 'result');
      const setupCode = params.setup.length > 0 ? params.setup.join('\n') + '\n' : '';
      return `${setupCode}  ${resultType} result = ${functionName}(${params.args});\n${resultVisualization}`;
    }

    // Generate the function call with actual parameters
    const resultType = varInfo.type;
    const resultVisualization = this.generateReturnStatementForVar(resultType, 'result');

    return `${setupLines.join('\n')}\n  ${resultType} result = ${functionName}(${callInfo.params});\n${resultVisualization}`;
  }

  private buildVariableTypeMap(
    lines: string[],
    upToLine: number,
    functionInfo: { name: string | null; start: number; end: number }
  ): Map<string, string> {
    const varTypes = new Map<string, string>();

    // First, add function parameters if we're inside a function
    if (functionInfo.name && functionInfo.start >= 0) {
      const funcLine = lines[functionInfo.start];
      const paramsMatch = funcLine.match(/\(([^)]*)\)/);

      if (paramsMatch && paramsMatch[1].trim()) {
        const paramsStr = paramsMatch[1];
        const paramPairs = paramsStr.split(',').map(p => p.trim());

        for (const pair of paramPairs) {
          // Match: type name (e.g., "vec2 p", "float radius", "out vec4 fragColor")
          const match = pair.match(/(?:in|out|inout)?\s*(vec2|vec3|vec4|float|int|bool|mat2|mat3|mat4|sampler2D)\s+(\w+)/);
          if (match) {
            const type = match[1];
            const name = match[2];
            varTypes.set(name, type);
          }
        }
      }
    }

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

  private detectVariableAndType(lineContent: string, varTypes: Map<string, string>, functionReturnType?: string): { name: string; type: string } | null {
    // Check for return statements first
    const returnMatch = lineContent.match(/^\s*return\s+(.+);/);
    if (returnMatch && functionReturnType) {
      // For return statements, create a temporary variable name
      return { name: '_dbgReturn', type: functionReturnType };
    }

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
