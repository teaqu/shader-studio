/**
 * Pure static utility for decoding float FBO readback data.
 * No WebGL dependency — fully unit testable.
 */
export class CaptureDecoder {
  /**
   * Decode RGBA float array → component values based on varType.
   * float/int/bool → [R], vec2 → [R,G], vec3 → [R,G,B], vec4 → [R,G,B,A]
   */
  static decodePixel(rgba: Float32Array, varType: string): number[] {
    switch (varType) {
      case 'float':
      case 'int':
      case 'bool':
        return [rgba[0]];
      case 'vec2':
        return [rgba[0], rgba[1]];
      case 'vec3':
        return [rgba[0], rgba[1], rgba[2]];
      case 'vec4':
      case 'mat2':
        return [rgba[0], rgba[1], rgba[2], rgba[3]];
      default:
        return [rgba[0]];
    }
  }

  /**
   * Extract one component across all pixels in a grid readback.
   * pixelData: flat Float32Array of (gridSize*gridSize*4) floats (RGBA row-major).
   */
  static extractComponentGrid(
    pixelData: Float32Array,
    gridSize: number,
    componentIndex: number, // 0=R, 1=G, 2=B, 3=A
  ): Float32Array {
    const numPixels = gridSize * gridSize;
    const result = new Float32Array(numPixels);
    for (let i = 0; i < numPixels; i++) {
      result[i] = pixelData[i * 4 + componentIndex];
    }
    return result;
  }

  static computeStats(values: Float32Array): { min: number; max: number; mean: number } {
    if (values.length === 0) {
      return { min: 0, max: 0, mean: 0 };
    }

    let min = values[0];
    let max = values[0];
    let sum = 0;

    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }

    return { min, max, mean: sum / values.length };
  }

  static buildHistogram(
    values: Float32Array,
    binCount: number,
  ): { bins: number[]; min: number; max: number } {
    const bins = new Array<number>(binCount).fill(0);

    if (values.length === 0) {
      return { bins, min: 0, max: 0 };
    }

    const { min, max } = CaptureDecoder.computeStats(values);

    const range = max - min;
    if (range === 0) {
      // All values equal — put everything in middle bin
      bins[Math.floor(binCount / 2)] = values.length;
      return { bins, min, max };
    }

    for (let i = 0; i < values.length; i++) {
      const normalized = (values[i] - min) / range;
      const binIndex = Math.min(Math.floor(normalized * binCount), binCount - 1);
      bins[binIndex]++;
    }

    return { bins, min, max };
  }

  /**
   * Build histogram with explicit global min/max bounds (for shared-axis multi-channel histograms).
   */
  static buildHistogramWithBounds(
    values: Float32Array,
    binCount: number,
    globalMin: number,
    globalMax: number,
  ): { bins: number[]; min: number; max: number } {
    const bins = new Array<number>(binCount).fill(0);

    if (values.length === 0) {
      return { bins, min: globalMin, max: globalMax };
    }

    const range = globalMax - globalMin;
    if (range === 0) {
      bins[Math.floor(binCount / 2)] = values.length;
      return { bins, min: globalMin, max: globalMax };
    }

    for (let i = 0; i < values.length; i++) {
      const normalized = (values[i] - globalMin) / range;
      const binIndex = Math.min(Math.max(Math.floor(normalized * binCount), 0), binCount - 1);
      bins[binIndex]++;
    }

    return { bins, min: globalMin, max: globalMax };
  }
}
