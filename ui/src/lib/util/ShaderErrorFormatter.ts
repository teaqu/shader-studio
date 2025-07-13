export class ShaderErrorFormatter {
  /**
   * Formats shader compilation errors by adjusting line numbers to match user code
   * instead of the wrapped/injected shader code.
   * 
   * @param error - The raw shader compilation error string
   * @param renderer - The renderer instance (for getting header line count)
   * @param headerLineCount - Number of lines added by code wrapping
   * @returns Formatted error string with corrected line numbers
   */
  public static formatShaderError(
    error: string,
    renderer: any,
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
