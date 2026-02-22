import type { PiRenderer } from "../types/piRenderer";

export interface FormattedErrorLine {
  message: string;
  line: number;
  isCommonBufferError: boolean;
}

export class ShaderErrorFormatter {

  public static formatShaderError(
    error: string,
    renderer: PiRenderer,
    headerLineCount: number,
    commonCodeLineCount: number = 0,
  ): FormattedErrorLine[] {
    const sanitized = error
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();

    const rendererHeaderLines = renderer.GetShaderHeaderLines(1);
    const uniformHeaderLines = headerLineCount - commonCodeLineCount;
    const commonCodeStart = rendererHeaderLines + uniformHeaderLines;
    const totalHeaderLines = rendererHeaderLines + headerLineCount;

    // Split on newlines, then split lines that contain multiple ERROR patterns
    // (some GPU drivers output multiple errors on a single line)
    const rawLines = sanitized.split('\n');
    const lines: string[] = [];
    for (const rawLine of rawLines) {
      const parts = rawLine.split(/(?=ERROR: 0:\d+:)/);
      if (parts.length > 1) {
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed) {
            lines.push(trimmed);
          }
        }
      } else {
        lines.push(rawLine);
      }
    }

    const results: FormattedErrorLine[] = [];

    for (const line of lines) {
      const errorMatch = line.match(/ERROR: 0:(\d+):/);
      if (errorMatch) {
        const rawLine = parseInt(errorMatch[1], 10);
        let isCommonBufferError = false;
        let adjustedLine: number;

        if (commonCodeLineCount > 0 && rawLine > commonCodeStart && rawLine <= commonCodeStart + commonCodeLineCount) {
          isCommonBufferError = true;
          adjustedLine = rawLine - commonCodeStart;
        } else {
          adjustedLine = Math.max(1, rawLine - totalHeaderLines);
        }

        const adjustedMessage = line.replace(/ERROR: 0:\d+:/, `ERROR: 0:${adjustedLine}:`);

        results.push({
          message: adjustedMessage,
          line: adjustedLine,
          isCommonBufferError,
        });
      } else if (results.length > 0) {
        // Non-ERROR continuation line — attach to previous error
        results[results.length - 1].message += '\n' + line;
      }
    }

    return results;
  }
}
