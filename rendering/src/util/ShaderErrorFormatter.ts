import type { PiRenderer } from "../types/piRenderer";

export class ShaderErrorFormatter {
  
  public static formatShaderError(
    error: string,
    renderer: PiRenderer,
    headerLineCount: number,
  ): string {
    const sanitized = error
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
    
    return sanitized.replace(/ERROR: 0:(\d+):/g, (m: any, p1: any) => {
      const totalHeaderLines = renderer.GetShaderHeaderLines(1) +
        headerLineCount;
      const userLine = Math.max(1, parseInt(p1, 10) - totalHeaderLines);
      return `ERROR: 0:${userLine}:`;
    });
  }
}
