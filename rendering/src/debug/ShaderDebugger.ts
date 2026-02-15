import { GlslParser } from './GlslParser';
import type { VarInfo } from './GlslParser';
import { CodeGenerator } from './CodeGenerator';

/**
 * Orchestrates shader modification for line-by-line debugging.
 * Takes shader code and a debug line, produces modified shader that
 * visualizes the value at that line.
 */
export class ShaderDebugger {
  /**
   * Modifies shader code to execute up to the debug line and visualize the result.
   * Returns modified code or null if modification fails.
   */
  public static modifyShaderForDebugging(
    originalCode: string,
    debugLine: number,
    lineContent: string,
  ): string | null {
    console.log('[ShaderDebug] === MODIFY SHADER ===');
    console.log('[ShaderDebug] Debug line number:', debugLine);

    const lines = originalCode.split('\n');

    console.log('[ShaderDebug] Cursor line content:', lineContent);
    console.log('[ShaderDebug] Actual shader line:', lines[debugLine] || '<out of bounds>');

    const functionInfo = GlslParser.findEnclosingFunction(lines, debugLine);
    console.log('[ShaderDebug] Function:', functionInfo.name || 'none');

    const varTypes = GlslParser.buildVariableTypeMap(lines, debugLine, functionInfo);

    // Extract function return type if we're in a function
    let functionReturnType: string | undefined;
    if (functionInfo.name && functionInfo.start >= 0) {
      const funcLine = lines[functionInfo.start];
      const returnTypeMatch = funcLine.match(/^\s*(void|float|vec2|vec3|vec4|mat2|mat3|mat4)\s+\w+\s*\(/);
      if (returnTypeMatch) {
        functionReturnType = returnTypeMatch[1];
      }
    }

    const actualLineContent = lines[debugLine] || '';
    const varInfo = GlslParser.detectVariableAndType(actualLineContent, varTypes, functionReturnType, lines, debugLine);
    if (!varInfo) {
      console.log('[ShaderDebug] ❌ Could not detect variable/type');
      return null;
    }
    console.log('[ShaderDebug] ✓ Detected:', varInfo.name, `(${varInfo.type})`);

    let result: string;

    if (functionInfo.name === 'mainImage') {
      console.log('[ShaderDebug] Path: mainImage truncation');
      result = this.truncateMainImage(lines, debugLine, functionInfo.start, varInfo);
    } else if (functionInfo.name) {
      console.log('[ShaderDebug] Path: helper function wrapper');
      result = CodeGenerator.wrapFunctionForDebugging(lines, functionInfo, debugLine, varInfo);
    } else {
      console.log('[ShaderDebug] Path: one-liner wrapper');
      result = CodeGenerator.wrapOneLinerForDebugging(lineContent, varInfo);
    }

    console.log('[ShaderDebug] ✅ Success - Modified shader:\n', result);
    return result;
  }

  private static truncateMainImage(
    lines: string[],
    debugLine: number,
    functionStart: number,
    varInfo: VarInfo
  ): string {
    const stripComments = (line: string): string => {
      const commentIndex = line.indexOf('//');
      return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
    };

    // Find the end of the statement (may span multiple lines)
    let endLine = debugLine;
    const debugLineContent = stripComments(lines[debugLine]).trim();
    if (!debugLineContent.endsWith(';') && !debugLineContent.endsWith('{') && !debugLineContent.endsWith('}')) {
      for (let i = debugLine + 1; i < lines.length && i < debugLine + 10; i++) {
        if (stripComments(lines[i]).trim().endsWith(';')) {
          endLine = i;
          break;
        }
      }
      console.log('[ShaderDebug] Multi-line statement extends to line', endLine);
    }

    const truncatedLines = lines.slice(0, endLine + 1);
    const cleanedLines = CodeGenerator.removeControlFlowKeywords(truncatedLines, functionStart);
    cleanedLines.push(CodeGenerator.generateReturnStatementForVar(varInfo.type, varInfo.name));
    cleanedLines.push('}');
    return cleanedLines.join('\n');
  }
}
