import type { PiRenderer } from "../types/piRenderer";

export class ShaderErrorFormatter {
  
  public static formatShaderError(
    error: string,
    renderer: PiRenderer,
    headerLineCount: number,
  ): string {
    return error.replace(/ERROR: 0:(\d+):/g, (m: any, p1: any) => {
      const totalHeaderLines = renderer.GetShaderHeaderLines(1) +
        headerLineCount;
      const userLine = Math.max(1, parseInt(p1, 10) - totalHeaderLines);
      return `ERROR: 0:${userLine}:`;
    });
  }
}
