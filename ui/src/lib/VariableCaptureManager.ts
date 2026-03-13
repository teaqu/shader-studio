import type { RenderingEngine } from '../../../rendering/src/types/RenderingEngine';
import type { VariableCapturer } from '../../../rendering/src/capture/VariableCapturer';
import { VariableCaptureBuilder } from '../../../debug/src/VariableCaptureBuilder';
import { CaptureDecoder } from '../../../rendering/src/capture/CaptureDecoder';

export interface ColorFrequency {
  r: number; g: number; b: number;  // 0–1 range
  freq: number;                     // fraction of total samples
}

export type RefreshMode = 'polling' | 'manual' | 'realtime' | 'pause';

export interface CapturedVariable {
  varName: string;
  varType: string;
  declarationLine: number;         // 0-indexed line where the variable is declared
  value: number[] | null;          // pixel mode: exact component values
  channelMeans: number[] | null;   // grid mode: per-component means
  channelStats: Array<{ min: number; max: number; mean: number }> | null;  // grid mode: per-component stats
  stats: { min: number; max: number; mean: number } | null;  // grid mode scalar range (float/int/bool only)
  histogram: { bins: number[]; min: number; max: number } | null;  // expanded histogram (scalars only)
  channelHistograms: Array<{ bins: number[]; min: number; max: number; label: string }> | null;
  colorFrequencies: ColorFrequency[] | null;                         // expanded vec: top colors by frequency
  thumbnail: Uint8ClampedArray | null;                               // gridWidth×gridHeight×4 RGBA bytes for spatial preview
  gridWidth: number;               // thumbnail pixel width
  gridHeight: number;              // thumbnail pixel height
}

/**
 * Build a displayable RGBA thumbnail from float capture data.
 * Raw clamp to [0,1] — no normalization — so actual shader colour values
 * are preserved faithfully (e.g. light = uv.y / 9 stays near-black).
 */
function buildThumbnail(
  rgba: Float32Array,
  varType: string,
  gridWidth: number,
  gridHeight: number,
): Uint8ClampedArray {
  const totalPixels = gridWidth * gridHeight;
  const pixels = new Uint8ClampedArray(totalPixels * 4);
  const isScalar = varType === 'float' || varType === 'int' || varType === 'bool';
  const clamp = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);

  for (let i = 0; i < totalPixels; i++) {
    if (isScalar) {
      const v = clamp(rgba[i * 4]);
      pixels[i * 4 + 0] = v;
      pixels[i * 4 + 1] = v;
      pixels[i * 4 + 2] = v;
    } else {
      pixels[i * 4 + 0] = clamp(rgba[i * 4 + 0]);
      pixels[i * 4 + 1] = clamp(rgba[i * 4 + 1]);
      pixels[i * 4 + 2] = clamp(rgba[i * 4 + 2]);
    }
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

/**
 * Quantize and count colors from a grid capture, returning the most frequent colors.
 * Uses 8 levels per channel (step ~0.143) for sensible clustering.
 */
function computeColorFrequencies(
  rgba: Float32Array,
  gridWidth: number,
  gridHeight: number,
  compCount: number,
): ColorFrequency[] {
  const LEVELS = 8;
  const totalPixels = gridWidth * gridHeight;
  const counts = new Map<number, { r: number; g: number; b: number; count: number }>();

  for (let i = 0; i < totalPixels; i++) {
    const r = Math.max(0, Math.min(1, rgba[i * 4]));
    const g = compCount > 1 ? Math.max(0, Math.min(1, rgba[i * 4 + 1])) : 0;
    const b = compCount > 2 ? Math.max(0, Math.min(1, rgba[i * 4 + 2])) : 0;

    const qr = Math.round(r * (LEVELS - 1));
    const qg = Math.round(g * (LEVELS - 1));
    const qb = Math.round(b * (LEVELS - 1));
    const key = qr * LEVELS * LEVELS + qg * LEVELS + qb;

    if (counts.has(key)) {
      counts.get(key)!.count++;
    } else {
      counts.set(key, { r: qr / (LEVELS - 1), g: qg / (LEVELS - 1), b: qb / (LEVELS - 1), count: 1 });
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map(c => ({ r: c.r, g: c.g, b: c.b, freq: c.count / totalPixels }));
}

interface CaptureParams {
  code: string;
  debugLine: number | null;
  pixelX: number | null;
  pixelY: number | null;
  canvasWidth: number;
  canvasHeight: number;
  loopMaxIters: Map<number, number>;
  customParams: Map<number, string>;
  sampleSize: number;
  refreshMode: RefreshMode;
  pollingMs: number;
}

/**
 * Compute grid dimensions that match the canvas aspect ratio.
 * Total pixels ≈ sampleSize², but shaped to match the shader's aspect ratio.
 */
export function computeGridDimensions(
  sampleSize: number,
  canvasWidth: number,
  canvasHeight: number,
): { gridWidth: number; gridHeight: number } {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return { gridWidth: sampleSize, gridHeight: sampleSize };
  }

  const aspect = canvasWidth / canvasHeight;
  const totalPixels = sampleSize * sampleSize;

  // gridWidth / gridHeight = aspect
  // gridWidth * gridHeight = totalPixels
  // => gridHeight = sqrt(totalPixels / aspect)
  const gridHeight = Math.max(1, Math.round(Math.sqrt(totalPixels / aspect)));
  const gridWidth = Math.max(1, Math.round(gridHeight * aspect));

  return { gridWidth, gridHeight };
}

export class VariableCaptureManager {
  private capturer: VariableCapturer | null = null;
  private dirty = false;
  private rafHandle: number | null = null;
  private loopRunning = false;
  private lastParams: CaptureParams | null = null;
  private expandedVars = new Set<string>();
  private collecting = false;
  private disposed = false;
  // Accumulate partial PBO results until all fences have signaled
  private pendingResults: Array<{ varName: string; varType: string; rgba: Float32Array }> = [];
  private expectedCount = 0;
  private declaredOrder: string[] = [];
  private varDeclarationLines: Map<string, number> = new Map();
  private lastGridWidth = 32;
  private lastGridHeight = 32;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private renderingEngine: RenderingEngine,
    private onUpdate: (vars: CapturedVariable[]) => void,
  ) {}

  /**
   * Called when any relevant state changes. Marks dirty and schedules capture.
   */
  notifyStateChange(params: CaptureParams): void {
    this.lastParams = params;
    // Cancel any stale poll timeout so old intervals don't conflict with new params
    if (this.pollTimeout !== null) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    // Paused: store params but don't issue captures
    if (params.refreshMode === 'pause') { return; }
    this.dirty = true;
    if (!this.loopRunning && !this.disposed) {
      this.loopRunning = true;
      this.rafHandle = requestAnimationFrame((ts) => this.captureLoop(ts));
    }
  }

  setHistogramExpanded(varName: string, expanded: boolean): void {
    if (expanded) {
      this.expandedVars.add(varName);
    } else {
      this.expandedVars.delete(varName);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.loopRunning = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    if (this.pollTimeout !== null) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    if (this.capturer) {
      this.capturer.dispose();
      this.capturer = null;
    }
  }

  private captureLoop(_timestamp: number): void {
    if (this.disposed) { this.loopRunning = false; return; }
    this.rafHandle = null;

    // Always try to collect pending results first
    if (this.collecting && this.capturer) {
      const results = this.capturer.collectResults();
      if (results.length > 0) {
        this.pendingResults.push(...results);
        if (this.pendingResults.length >= this.expectedCount) {
          this.decodeAndUpdate(this.pendingResults);
          this.pendingResults = [];
        }
      }
    }

    // Issue new captures as soon as previous batch is done
    if (this.dirty && !this.collecting && this.lastParams) {
      this.dirty = false;
      this.issueCaptures(this.lastParams);
    }

    // Continue loop while there's pending work; otherwise stop (or schedule poll/realtime).
    const mode = this.lastParams?.refreshMode ?? 'manual';
    if (this.dirty || this.collecting) {
      this.rafHandle = requestAnimationFrame((ts) => this.captureLoop(ts));
    } else if (mode === 'realtime') {
      // Realtime: keep rAF loop running, re-mark dirty each frame
      this.dirty = true;
      this.rafHandle = requestAnimationFrame((ts) => this.captureLoop(ts));
    } else {
      this.loopRunning = false;
      // Schedule next poll if polling mode with ms > 0
      if (mode === 'polling' && this.lastParams && this.lastParams.pollingMs > 0) {
        this.pollTimeout = setTimeout(() => {
          this.pollTimeout = null;
          if (!this.disposed && this.lastParams) {
            this.dirty = true;
            if (!this.loopRunning) {
              this.loopRunning = true;
              this.rafHandle = requestAnimationFrame((ts) => this.captureLoop(ts));
            }
          }
        }, this.lastParams.pollingMs);
      }
    }
  }

  private issueCaptures(params: CaptureParams): void {
    if (!this.capturer) {
      try {
        this.capturer = this.renderingEngine.createVariableCapturer();
      } catch {
        return;
      }
    }

    const resolvedLine = params.debugLine !== null ? params.debugLine : -1;

    const vars = VariableCaptureBuilder.getAllInScopeVariables(params.code, resolvedLine);
    if (vars.length === 0) {
      this.onUpdate([]);
      return;
    }

    const isPixelMode = params.pixelX !== null && params.pixelY !== null;

    const { gridWidth, gridHeight } = computeGridDimensions(
      params.sampleSize,
      params.canvasWidth,
      params.canvasHeight,
    );

    const captures: Array<{ varName: string; varType: string; captureShader: string }> = [];

    // Store declaration lines for each variable
    this.varDeclarationLines.clear();
    for (const v of vars) {
      this.varDeclarationLines.set(v.varName, v.declarationLine);
      const shader = VariableCaptureBuilder.generateCaptureShader(
        params.code,
        resolvedLine,
        v.varName,
        v.varType,
        params.loopMaxIters,
        params.customParams,
        isPixelMode,
        gridWidth,
        gridHeight,
      );
      if (shader) {
        captures.push({ varName: v.varName, varType: v.varType, captureShader: shader });
      }
    }

    if (captures.length === 0) { return; }

    const uniforms = this.renderingEngine.getCaptureUniforms();
    this.pendingResults = [];
    this.declaredOrder = captures.map(c => c.varName);
    this.lastGridWidth = gridWidth;
    this.lastGridHeight = gridHeight;

    let issued: number;
    if (isPixelMode) {
      issued = this.capturer.issueCaptureAtPixel(
        captures,
        params.pixelX!,
        params.pixelY!,
        params.canvasWidth,
        params.canvasHeight,
        uniforms,
      );
    } else {
      issued = this.capturer.issueCaptureGrid(captures, uniforms, gridWidth, gridHeight);
    }

    if (issued === 0) { return; }
    this.expectedCount = issued;
    this.collecting = true;

    // Store mode context for decoding
    (this as any)._lastCaptureMode = isPixelMode ? 'pixel' : 'grid';
    (this as any)._lastCaptures = captures.map(c => ({ varName: c.varName, varType: c.varType }));
  }

  private decodeAndUpdate(
    results: Array<{ varName: string; varType: string; rgba: Float32Array }>
  ): void {
    const isPixelMode = (this as any)._lastCaptureMode === 'pixel';
    const capturedVars: CapturedVariable[] = [];

    const isScalar = (t: string) => t === 'float' || t === 'int' || t === 'bool';

    for (const result of results) {
      if (isPixelMode) {
        // 1×1 capture: exact component values
        const value = CaptureDecoder.decodePixel(result.rgba, result.varType);
        capturedVars.push({
          varName: result.varName,
          varType: result.varType,
          declarationLine: this.varDeclarationLines.get(result.varName) ?? 0,
          value,
          channelMeans: null,
          channelStats: null,
          stats: null,
          histogram: null,
          channelHistograms: null,
          colorFrequencies: null,
          thumbnail: null,
          gridWidth: 1,
          gridHeight: 1,
        });
      } else {
        // Grid capture
        const gridWidth = this.lastGridWidth;
        const gridHeight = this.lastGridHeight;
        const compCount = CaptureDecoder.decodePixel(new Float32Array([0, 0, 0, 0]), result.varType).length;
        const componentStats: { min: number; max: number; mean: number }[] = [];
        const grids: Float32Array[] = [];

        for (let c = 0; c < compCount; c++) {
          grids.push(CaptureDecoder.extractComponentGrid(result.rgba, gridWidth, c, gridHeight));
        }

        for (let c = 0; c < compCount; c++) {
          componentStats.push(CaptureDecoder.computeStats(grids[c]));
        }

        // Per-component means (useful for vec2/3/4 and also scalars)
        const channelMeans = componentStats.map(s => s.mean);

        // Scalar-only: range stats + optional histogram
        let stats: { min: number; max: number; mean: number } | null = null;
        let histogram: { bins: number[]; min: number; max: number } | null = null;
        let channelHistograms: Array<{ bins: number[]; min: number; max: number; label: string }> | null = null;
        let colorFrequencies: ColorFrequency[] | null = null;

        if (isScalar(result.varType)) {
          stats = componentStats[0];
          if (this.expandedVars.has(result.varName)) {
            histogram = CaptureDecoder.buildHistogram(grids[0], 20);
          }
        } else if (this.expandedVars.has(result.varName)) {
          // Vec types: color frequency palette + per-channel histograms
          colorFrequencies = computeColorFrequencies(result.rgba, gridWidth, gridHeight, compCount);
          const channelLabels = ['x', 'y', 'z', 'w'];
          channelHistograms = grids.map((grid, c) => ({
            ...CaptureDecoder.buildHistogram(grid, 20),
            label: channelLabels[c] ?? `c${c}`,
          }));
        }

        const thumbnail = buildThumbnail(result.rgba, result.varType, gridWidth, gridHeight);

        capturedVars.push({
          varName: result.varName,
          varType: result.varType,
          declarationLine: this.varDeclarationLines.get(result.varName) ?? 0,
          value: null,
          channelMeans,
          channelStats: componentStats,
          stats,
          histogram,
          channelHistograms,
          colorFrequencies,
          thumbnail,
          gridWidth,
          gridHeight,
        });
      }
    }

    if (capturedVars.length > 0) {
      // Sort by the order variables were declared in the shader
      capturedVars.sort((a, b) => {
        const ai = this.declaredOrder.indexOf(a.varName);
        const bi = this.declaredOrder.indexOf(b.varName);
        return ai - bi;
      });
      this.collecting = false;
      this.onUpdate(capturedVars);
    }
  }
}
