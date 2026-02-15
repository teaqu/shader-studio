export interface FunctionInfo {
  name: string | null;
  start: number;
  end: number;
}

export interface VarInfo {
  name: string;
  type: string;
}

export class GlslParser {
  static findMainImageStart(lines: string[]): number {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('void mainImage')) {
        return i;
      }
    }
    return -1;
  }

  static findEnclosingFunction(lines: string[], lineNum: number): FunctionInfo {
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
        if (braceDepth < 0) {
          functionName = funcMatch[1];
          functionStart = i;
          break;
        }
        if (braceDepth === 0 && line.includes('{')) {
          functionName = funcMatch[1];
          functionStart = i;
          break;
        }
        if (braceDepth === 0 && i + 1 < lines.length && lines[i + 1].trim() === '{') {
          functionName = funcMatch[1];
          functionStart = i;
          break;
        }
      }

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

  static buildVariableTypeMap(
    lines: string[],
    upToLine: number,
    functionInfo: FunctionInfo
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
          const match = pair.match(/(?:in|out|inout)?\s*(vec2|vec3|vec4|float|int|bool|mat2|mat3|mat4|sampler2D)\s+(\w+)/);
          if (match) {
            varTypes.set(match[2], match[1]);
          }
        }
      }
    }

    // Scan all lines up to and including the debug line
    for (let i = 0; i <= upToLine && i < lines.length; i++) {
      const line = lines[i];

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

  static detectVariableAndType(
    lineContent: string,
    varTypes: Map<string, string>,
    functionReturnType?: string,
    lines?: string[],
    lineIndex?: number
  ): VarInfo | null {
    console.log('[ShaderDebug] === DETECT VARIABLE ===');
    console.log('[ShaderDebug] Line:', lineContent);
    console.log('[ShaderDebug] Available vars in scope:', Array.from(varTypes.keys()));

    // Handle multi-line statements
    let fullStatement = lineContent;
    if (lines && lineIndex !== undefined) {
      const stripComments = (line: string): string => {
        const commentIndex = line.indexOf('//');
        return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
      };

      const trimmed = stripComments(lineContent).trim();

      const currentLineIncomplete = !trimmed.endsWith(';') &&
                                    !trimmed.endsWith('{') &&
                                    !trimmed.endsWith('}') &&
                                    trimmed.length > 0;

      const prevLineIncomplete = lineIndex > 0 &&
                                 (() => {
                                   const prevLineTrimmed = stripComments(lines[lineIndex - 1]).trim();
                                   return prevLineTrimmed.length > 0 &&
                                          !prevLineTrimmed.endsWith(';') &&
                                          !prevLineTrimmed.endsWith('{') &&
                                          !prevLineTrimmed.endsWith('}');
                                 })();

      const isPartOfMultiLine = currentLineIncomplete || prevLineIncomplete;

      if (isPartOfMultiLine) {
        let startLine = lineIndex;
        for (let i = lineIndex - 1; i >= 0 && i >= lineIndex - 10; i--) {
          const prevLine = stripComments(lines[i]).trim();
          if (prevLine.endsWith(';') || prevLine.endsWith('{') || prevLine.endsWith('}') || prevLine.length === 0) {
            startLine = i + 1;
            break;
          }
          if (i === 0) {
            startLine = 0;
          }
        }

        let endLine = lineIndex;
        for (let i = lineIndex; i < lines.length && i < lineIndex + 10; i++) {
          const line = stripComments(lines[i]).trim();
          if (line.endsWith(';')) {
            endLine = i;
            break;
          }
        }

        const statementLines = lines.slice(startLine, endLine + 1);
        fullStatement = statementLines.join(' ');
        console.log(`[ShaderDebug] Multi-line statement detected (lines ${startLine}-${endLine}), combined:`, fullStatement);
      }
    }

    // Check for return statements first
    const returnMatch = fullStatement.match(/^\s*return\s+(.+);/);
    if (returnMatch && functionReturnType) {
      console.log('[ShaderDebug] ✓ Matched return statement, type:', functionReturnType);
      return { name: '_dbgReturn', type: functionReturnType };
    }

    // Try to match a variable declaration
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
      const match = fullStatement.match(pattern);
      if (match && match[2]) {
        console.log(`[ShaderDebug] ✓ Matched declaration: ${match[2]} (${type})`);
        return { name: match[2], type };
      }
    }
    console.log('[ShaderDebug] ✗ No declaration pattern matched');

    // Try to match a reassignment or compound assignment
    const assignPatterns = [
      { pattern: /(\w+)\s*\*=/, name: 'compound *=' },
      { pattern: /(\w+)\s*\+=/, name: 'compound +=' },
      { pattern: /(\w+)\s*-=/, name: 'compound -=' },
      { pattern: /(\w+)\s*\/=/, name: 'compound /=' },
      { pattern: /^\s*(\w+)\s*=(?!\s*=)/, name: 'reassignment' },
    ];

    for (const { pattern, name } of assignPatterns) {
      const match = fullStatement.match(pattern);
      if (match && match[1]) {
        const varName = match[1];
        const varType = varTypes.get(varName);
        console.log(`[ShaderDebug] Trying ${name}: found var '${varName}', type: ${varType || 'NOT IN SCOPE'}`);
        if (varType) {
          console.log(`[ShaderDebug] ✓ Matched ${name}: ${varName} (${varType})`);
          return { name: varName, type: varType };
        }
      }
    }
    console.log('[ShaderDebug] ✗ No reassignment pattern matched');

    // Try to match member access assignments
    const memberAccessPatterns = [
      { pattern: /(\w+)\.[xyzw]\s*\*=/, name: 'member access *=' },
      { pattern: /(\w+)\.[xyzw]\s*\+=/, name: 'member access +=' },
      { pattern: /(\w+)\.[xyzw]\s*-=/, name: 'member access -=' },
      { pattern: /(\w+)\.[xyzw]\s*\/=/, name: 'member access /=' },
      { pattern: /(\w+)\.[xyzw]\s*=/, name: 'member access =' },
      { pattern: /(\w+)\.[rgba]\s*\*=/, name: 'color member *=' },
      { pattern: /(\w+)\.[rgba]\s*\+=/, name: 'color member +=' },
      { pattern: /(\w+)\.[rgba]\s*-=/, name: 'color member -=' },
      { pattern: /(\w+)\.[rgba]\s*\/=/, name: 'color member /=' },
      { pattern: /(\w+)\.[rgba]\s*=/, name: 'color member =' },
      { pattern: /(\w+)\.[xy]+\s*\*=/, name: 'swizzle *=' },
      { pattern: /(\w+)\.[xy]+\s*\+=/, name: 'swizzle +=' },
      { pattern: /(\w+)\.[xy]+\s*=/, name: 'swizzle =' },
    ];

    for (const { pattern, name } of memberAccessPatterns) {
      const match = fullStatement.match(pattern);
      if (match && match[1]) {
        const varName = match[1];
        const varType = varTypes.get(varName);
        console.log(`[ShaderDebug] Trying ${name}: found var '${varName}', type: ${varType || 'NOT IN SCOPE'}`);
        if (varType) {
          console.log(`[ShaderDebug] ✓ Matched ${name}: ${varName} (${varType})`);
          return { name: varName, type: varType };
        }
      }
    }
    console.log('[ShaderDebug] ✗ No member access pattern matched');

    console.log('[ShaderDebug] ✗ Could not detect variable/type');
    return null;
  }

  static findFunctionCall(
    lines: string[],
    functionName: string
  ): { params: string; lineIndex: number } | null {
    const callPattern = new RegExp(`${functionName}\\s*\\(([^)]*)\\)`, 'i');
    const declPattern = new RegExp(`^\\s*(void|float|vec2|vec3|vec4|mat2|mat3|mat4)\\s+${functionName}\\s*\\(`, 'i');

    const mainImageStart = GlslParser.findMainImageStart(lines);
    if (mainImageStart === -1) {
      return null;
    }

    let braceDepth = 0;
    let mainImageEnd = -1;
    for (let i = mainImageStart; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{') braceDepth++;
        if (char === '}') braceDepth--;
      }
      if (braceDepth === 0 && i > mainImageStart) {
        mainImageEnd = i;
        break;
      }
    }

    if (mainImageEnd === -1) {
      mainImageEnd = lines.length;
    }

    for (let i = mainImageStart; i <= mainImageEnd; i++) {
      const line = lines[i];

      if (declPattern.test(line)) {
        continue;
      }

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
}
