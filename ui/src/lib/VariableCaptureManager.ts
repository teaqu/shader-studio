import type { RenderingEngine } from '../../../rendering/src/types/RenderingEngine';
import type { IVariableCapturer } from '../../../rendering/src/capture/VariableCapturer';
import { VariableCaptureBuilder } from '@shader-studio/debug';
import { CaptureDecoder } from '../../../rendering/src/capture/CaptureDecoder';
import { captureCounters, captureDiagTick, captureDiagEvent } from '../../../rendering/src/capture/captureDiagnostics';
import type { ConfigInput, DebugInstrumentationPlan, DebugVisibleValue } from '@shader-studio/types';
import type { CaptureError } from '../../../rendering/src/capture/CaptureErrorLog';
import { dedupeCompilerErrors } from '../../../rendering/src/util/CompilerErrorDedupe';

const CAPTURABLE_TYPES = new Set([
  'float', 'int', 'bool',
  'vec2', 'vec3', 'vec4', 'mat2',
  'float2', 'float3', 'float4', 'float2x2',
]);
const MAX_EMPTY_COLLECTION_FRAMES = 120;

/** One capture failure, named against the variable it belongs to where known. */
export type CaptureIssue = CaptureError;

export interface ColorFrequency {
  r: number; g: number; b: number;  // 0–1 range
  freq: number;                     // fraction of total samples
}

export type RefreshMode = 'polling' | 'manual' | 'realtime' | 'pause';

const SESSION_SETTINGS_KEY = 'shader-studio.variable-capture.settings';

interface CaptureSessionSettings {
  sampleSize: number;
  gridRefreshMode: RefreshMode;
  gridPollingMs: number;
  pixelRefreshMode: RefreshMode;
  pixelPollingMs: number;
}

const DEFAULT_SESSION_SETTINGS: CaptureSessionSettings = {
  sampleSize: 32,
  gridRefreshMode: 'polling',
  gridPollingMs: 500,
  pixelRefreshMode: 'polling',
  pixelPollingMs: 500,
};

function isRefreshMode(value: unknown): value is RefreshMode {
  return value === 'polling' || value === 'manual' || value === 'realtime' || value === 'pause';
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function getSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readSessionSettings(): CaptureSessionSettings {
  const storage = getSessionStorage();
  if (!storage) {
    return { ...DEFAULT_SESSION_SETTINGS };
  }

  try {
    const raw = storage.getItem(SESSION_SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_SESSION_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<CaptureSessionSettings>;
    return {
      sampleSize: positiveNumber(parsed.sampleSize, DEFAULT_SESSION_SETTINGS.sampleSize),
      gridRefreshMode: isRefreshMode(parsed.gridRefreshMode) ? parsed.gridRefreshMode : DEFAULT_SESSION_SETTINGS.gridRefreshMode,
      gridPollingMs: positiveNumber(parsed.gridPollingMs, DEFAULT_SESSION_SETTINGS.gridPollingMs),
      pixelRefreshMode: isRefreshMode(parsed.pixelRefreshMode) ? parsed.pixelRefreshMode : DEFAULT_SESSION_SETTINGS.pixelRefreshMode,
      pixelPollingMs: positiveNumber(parsed.pixelPollingMs, DEFAULT_SESSION_SETTINGS.pixelPollingMs),
    };
  } catch {
    return { ...DEFAULT_SESSION_SETTINGS };
  }
}

function writeSessionSettings(settings: CaptureSessionSettings): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(SESSION_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Best effort only; capture controls still work with instance-local state.
  }
}

export interface CapturedVariable {
  varName: string;
  varType: string;
  declarationLine: number;         // 0-indexed line where the variable is declared
  captureLine: number;             // 0-indexed debug line used to generate this capture
  captureFilePath: string | null;  // file the capture/debug line came from
  captureBufferName: string;       // Image/BufferA/etc. pass used for this capture
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

  // gl.readPixels returns bottom-to-top; putImageData expects top-to-bottom,
  // so we reverse rows to match the screen orientation.
  for (let y = 0; y < gridHeight; y++) {
    const srcRow = (gridHeight - 1 - y) * gridWidth;
    const dstRow = y * gridWidth;
    for (let x = 0; x < gridWidth; x++) {
      const srcIdx = (srcRow + x) * 4;
      const dstIdx = (dstRow + x) * 4;
      if (isScalar) {
        const v = clamp(rgba[srcIdx]);
        pixels[dstIdx + 0] = v;
        pixels[dstIdx + 1] = v;
        pixels[dstIdx + 2] = v;
      } else {
        pixels[dstIdx + 0] = clamp(rgba[srcIdx + 0]);
        pixels[dstIdx + 1] = clamp(rgba[srcIdx + 1]);
        pixels[dstIdx + 2] = clamp(rgba[srcIdx + 2]);
      }
      pixels[dstIdx + 3] = 255;
    }
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
  inputConfig?: Record<string, ConfigInput>;
  debugLine: number | null;
  pixelX: number | null;
  pixelY: number | null;
  canvasWidth: number;
  canvasHeight: number;
  loopMaxIters: Map<number, number>;
  customParams: Map<number, string>;
  activeBufferName?: string;
  filePath?: string | null;
  sampleSize: number;
  refreshMode: RefreshMode;
  pollingMs: number;
  slangCapture?: { plan: DebugInstrumentationPlan; values: DebugVisibleValue[] } | null;
  slangCaptureError?: string | null;
  /** First source line the shader compiler rejected, 1-based, when it named one. */
  compileErrorLine?: number | null;
  /** 1-based line range of the function that break sits in, when it is in one. */
  brokenFunctionRange?: { start: number; end: number } | null;
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

  const maxGridWidth = Math.max(1, Math.floor(canvasWidth));
  const maxGridHeight = Math.max(1, Math.floor(canvasHeight));

  if (gridWidth <= maxGridWidth && gridHeight <= maxGridHeight) {
    return { gridWidth, gridHeight };
  }

  const scale = Math.min(
    maxGridWidth / gridWidth,
    maxGridHeight / gridHeight,
    1,
  );

  return {
    gridWidth: Math.max(1, Math.floor(gridWidth * scale)),
    gridHeight: Math.max(1, Math.floor(gridHeight * scale)),
  };
}

export class VariableCaptureManager {
  private capturer: IVariableCapturer | null = null;
  private dirty = false;
  private rafHandle: number | null = null;
  private loopRunning = false;
  private lastParams: CaptureParams | null = null;
  private expandedVars = new Set<string>();
  private collecting = false;
  private issuing = false;
  private captureRequestId = 0;
  private collectionRequestId = 0;
  private disposed = false;
  // Accumulate partial PBO results until all fences have signaled
  private pendingResults: Array<{ varName: string; varType: string; rgba: Float32Array; hidden?: boolean }> = [];
  private expectedCount = 0;
  private emptyCollectFrames = 0;
  private declaredOrder: string[] = [];
  private varDeclarationLines: Map<string, number> = new Map();
  private lastGridWidth = 32;
  private lastGridHeight = 32;
  private lastCaptureMode: 'pixel' | 'grid' = 'grid';
  private lastCaptureLine = -1;
  private lastCaptureFilePath: string | null = null;
  private lastCaptureBufferName = 'Image';
  private pollTimeout: number | null = null;
  private _sampleSize = 32;
  private _gridRefreshMode: RefreshMode = 'polling';
  private _gridPollingMs = 500;
  private _pixelRefreshMode: RefreshMode = 'polling';
  private _pixelPollingMs = 500;
  private onSampleSettingsChanged: (() => void) | null = null;
  private onLoadingStateChanged: ((isLoading: boolean) => void) | null = null;
  private onErrorChanged: ((issues: CaptureIssue[]) => void) | null = null;
  /**
   * Why the capture stopped short of the inspected line. It explains what the
   * panel is showing, so it outlives the per-cycle clearing of failures.
   */
  private capNotice: CaptureIssue | null = null;

  constructor(
    private renderingEngine: RenderingEngine,
    private onUpdate: (vars: CapturedVariable[]) => void,
  ) {
    const settings = readSessionSettings();
    this._sampleSize = settings.sampleSize;
    this._gridRefreshMode = settings.gridRefreshMode;
    this._gridPollingMs = settings.gridPollingMs;
    this._pixelRefreshMode = settings.pixelRefreshMode;
    this._pixelPollingMs = settings.pixelPollingMs;
  }

  private setPollTimeout(callback: () => void, ms: number): number {
    return window.setTimeout(callback, ms);
  }

  private clearPollTimeout(): void {
    if (this.pollTimeout !== null) {
      window.clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  get sampleSize(): number {
    return this._sampleSize; 
  }
  get gridRefreshMode(): RefreshMode {
    return this._gridRefreshMode; 
  }
  get gridPollingMs(): number {
    return this._gridPollingMs; 
  }
  get pixelRefreshMode(): RefreshMode {
    return this._pixelRefreshMode; 
  }
  get pixelPollingMs(): number {
    return this._pixelPollingMs; 
  }

  setSampleSettingsCallback(callback: () => void): void {
    this.onSampleSettingsChanged = callback;
  }

  setLoadingStateCallback(callback: (isLoading: boolean) => void): void {
    this.onLoadingStateChanged = callback;
  }

  setErrorCallback(callback: (issues: CaptureIssue[]) => void): void {
    this.onErrorChanged = callback;
  }

  changeSampleSize(size: number): void {
    this._sampleSize = size;
    this.persistSessionSettings();
    this.onSampleSettingsChanged?.();
  }

  changeRefreshMode(mode: RefreshMode, hasPixelCapture: boolean): void {
    if (hasPixelCapture) {
      this._pixelRefreshMode = mode;
    } else {
      this._gridRefreshMode = mode;
    }
    this.persistSessionSettings();
    this.onSampleSettingsChanged?.();
  }

  changePollingMs(ms: number, hasPixelCapture: boolean): void {
    if (hasPixelCapture) {
      this._pixelPollingMs = ms;
    } else {
      this._gridPollingMs = ms;
    }
    this.persistSessionSettings();
    this.onSampleSettingsChanged?.();
  }

  getActiveRefreshMode(hasPixelCapture: boolean): RefreshMode {
    return hasPixelCapture ? this._pixelRefreshMode : this._gridRefreshMode;
  }

  getActivePollingMs(hasPixelCapture: boolean): number {
    return hasPixelCapture ? this._pixelPollingMs : this._gridPollingMs;
  }

  /**
   * Called when any relevant state changes. Marks dirty and schedules capture.
   */
  notifyStateChange(params: CaptureParams): void {
    this.captureRequestId += 1;
    this.lastParams = params;
    // If a loop is already running when a new state change arrives, that's
    // expected for polling/realtime — but flag it so a runaway (loopRunning
    // stuck true while ticks climb) is visible in the log stream.
    captureDiagEvent('notifyStateChange', {
      refreshMode: params.refreshMode,
      loopAlreadyRunning: this.loopRunning ? 1 : 0,
      // These are the params that decide vars/pixel-mode — watch for them
      // oscillating between rapid re-triggers.
      debugLine: params.debugLine,
      pixelX: params.pixelX,
      pixelY: params.pixelY,
      sampleSize: params.sampleSize,
      codeLen: params.code.length,
      requestId: this.captureRequestId,
    });
    // Cancel any stale poll timeout so old intervals don't conflict with new params
    this.clearPollTimeout();
    if (this.collecting) {
      this.cancelCurrentCollection(); // also calls cancelPendingCaptures
    } else {
      // During issuing phase: free stale GPU captures so PBOs/fences don't accumulate
      // across requests while async compiles yield between frames.
      this.capturer?.cancelPendingCaptures();
    }
    // Paused: store params but don't issue captures
    if (params.refreshMode === 'pause') {
      return; 
    }
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
    this.stop();
  }

  stop(): void {
    this.dirty = false;
    this.loopRunning = false;
    this.collecting = false;
    this.issuing = false;
    this.captureRequestId += 1;
    this.collectionRequestId = 0;
    this.lastParams = null;
    this.pendingResults = [];
    this.expectedCount = 0;
    this.emptyCollectFrames = 0;
    this.emitLoadingState(false);
    this.emitErrorState(null);
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.clearPollTimeout();
    if (this.capturer) {
      this.capturer.dispose();
      this.capturer = null;
    }
  }

  private captureLoop(_timestamp: number): void {
    if (this.disposed) {
      this.loopRunning = false; return;
    }
    this.rafHandle = null;
    captureCounters.loopTicks++;
    captureDiagTick('manager.loop', {
      dirty: this.dirty ? 1 : 0,
      collecting: this.collecting ? 1 : 0,
      issuing: this.issuing ? 1 : 0,
      pendingResults: this.pendingResults.length,
      expectedCount: this.expectedCount,
      emptyCollectFrames: this.emptyCollectFrames,
      expandedVars: this.expandedVars.size,
    });

    // Always try to collect pending results first
    if (this.collecting && this.capturer) {
      const activeRequestId = this.collectionRequestId;
      if (!this.isCurrentRequest(activeRequestId)) {
        this.cancelCurrentCollection();
      } else {
        const results = this.capturer.collectResults();
        if (results.length > 0) {
          this.emptyCollectFrames = 0;
          this.pendingResults.push(...results);
          if (this.pendingResults.length >= this.expectedCount && this.isCurrentRequest(activeRequestId)) {
            this.decodeAndUpdate(this.pendingResults);
          }
        } else if (this.noteEmptyCollectFrame()) {
          this.finishCollection([]);
        }
      }
    }

    // Issue new captures as soon as previous batch is done
    if (this.dirty && !this.collecting && !this.issuing && this.lastParams) {
      this.dirty = false;
      this.issuing = true;
      const requestId = this.captureRequestId;
      void this.issueCaptures(this.lastParams, requestId).finally(() => {
        this.issuing = false;
        const mode = this.lastParams?.refreshMode ?? 'manual';
        const shouldContinue =
          !this.disposed &&
          this.loopRunning &&
          (this.dirty || this.collecting || mode === 'realtime');

        if (!shouldContinue) {
          if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
          }
          if (!this.disposed && this.loopRunning) {
            this.finishIdleLoop(mode);
          }
          return;
        }

        if (this.rafHandle === null) {
          this.rafHandle = requestAnimationFrame((ts) => this.captureLoop(ts));
        }
      });
    }

    // Continue loop while there's pending work; otherwise stop (or schedule poll/realtime).
    const mode = this.lastParams?.refreshMode ?? 'manual';
    if (this.issuing) {
      // issueCaptures() schedules the next tick in its completion handler.
      // Scheduling here too permits parallel loop ticks while a GPU request
      // still refers to the previous debug pipeline.
      return;
    }
    if (this.dirty || this.collecting) {
      this.rafHandle = requestAnimationFrame((ts) => this.captureLoop(ts));
    } else if (mode === 'realtime') {
      // Realtime: keep rAF loop running, re-mark dirty each frame
      this.dirty = true;
      this.rafHandle = requestAnimationFrame((ts) => this.captureLoop(ts));
    } else {
      this.finishIdleLoop(mode);
    }
  }

  private finishIdleLoop(mode: RefreshMode): void {
    this.loopRunning = false;
    // Schedule next poll if polling mode with ms > 0
    if (mode === 'polling' && this.lastParams && this.lastParams.pollingMs > 0) {
      this.pollTimeout = this.setPollTimeout(() => {
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

  private isCurrentRequest(requestId: number): boolean {
    return requestId === this.captureRequestId && !this.disposed;
  }

  private persistSessionSettings(): void {
    writeSessionSettings({
      sampleSize: this._sampleSize,
      gridRefreshMode: this._gridRefreshMode,
      gridPollingMs: this._gridPollingMs,
      pixelRefreshMode: this._pixelRefreshMode,
      pixelPollingMs: this._pixelPollingMs,
    });
  }

  private cancelCurrentCollection(): void {
    this.capturer?.cancelPendingCaptures();
    this.collecting = false;
    this.collectionRequestId = 0;
    this.pendingResults = [];
    this.expectedCount = 0;
    this.emptyCollectFrames = 0;
    this.emitLoadingState(false);
  }

  private async issueCaptures(params: CaptureParams, requestId: number): Promise<void> {
    if (!this.isCurrentRequest(requestId)) {
      return;
    }
    captureCounters.issueCalls++;

    if (this.renderingEngine.getShaderLanguage?.() === 'slang' && params.slangCapture === null) {
      this.emitErrorState(params.slangCaptureError ?? null);
      this.finishCollection([]);
      return;
    }

    if (!this.capturer) {
      try {
        this.capturer = this.renderingEngine.createVariableCapturer();
      } catch {
        if (this.isCurrentRequest(requestId)) {
          this.emitErrorState('Failed to initialize variable capture');
        }
        return;
      }
    }

    if (!this.isCurrentRequest(requestId)) {
      return;
    }
    const captureCompileContext = this.renderingEngine.getShaderLanguage?.() === 'slang'
      ? this.renderingEngine.getVariableCaptureCompileContext(
        params.code,
        params.activeBufferName,
        params.filePath,
      )
      : this.renderingEngine.getVariableCaptureCompileContext(params.code, params.activeBufferName);
    this.capturer.setCompileContext(captureCompileContext);
    this.capturer.clearLastError();
    this.emitErrorState(null);

    const requestedLine = params.debugLine !== null ? params.debugLine : -1;
    // A capture is the shader truncated at the inspected line, so a broken
    // statement above that line is inside it and nothing compiles. Capturing at
    // the last line before the break still yields everything declared above it,
    // which is the part the shader can actually produce values for.
    // Only the function that was cut needs a capped line; capping elsewhere
    // would drag the capture into a function the user is not looking at.
    const range = params.brokenFunctionRange ?? null;
    const insideBrokenFunction = range === null
      || (requestedLine >= 0 && requestedLine + 1 >= range.start && requestedLine + 1 <= range.end);
    const blockedFrom = insideBrokenFunction ? params.compileErrorLine ?? null : null;
    // Capped to the break line itself: the cut leaves it empty, at the body's
    // own depth, so the capture there sees what survived the blocks above it.
    const cappedLine = blockedFrom !== null && requestedLine >= blockedFrom - 1
      ? blockedFrom - 1
      : requestedLine;
    const resolvedLine = cappedLine;

    this.capNotice = null;
    if (blockedFrom !== null && cappedLine !== requestedLine) {
      if (blockedFrom <= 1) {
        this.emitIssues([{ message: `Nothing to capture: the shader fails to compile from line ${blockedFrom}` }]);
        this.finishCollection([]);
        return;
      }
      this.capNotice = {
        // The last line that still compiles, which is the one below the break.
        message: `Capturing up to line ${blockedFrom - 1}: the shader fails to compile from line ${blockedFrom}`,
      };
      this.emitIssues([this.capNotice]);
    }

    let vars: Array<{ varName: string; varType: string; declarationLine: number }>;
    try {
      vars = params.slangCapture
        ? params.slangCapture.values.map((value) => ({ varName: value.name, varType: value.typeName, declarationLine: value.declarationRange.start.line }))
        : VariableCaptureBuilder.getAllInScopeVariables(params.code, resolvedLine);
    } catch {
      if (!this.isCurrentRequest(requestId)) {
        return;
      }
      this.emitErrorState('Failed to analyse variables for capture');
      this.finishCollection([]);
      return;
    }

    if (!this.isCurrentRequest(requestId)) {
      return;
    }

    // Append custom uniforms (declared in compiler header, not in user code)
    if (!params.slangCapture) {
      const customUniforms = this.renderingEngine.getCustomUniformInfo();
      for (const { name, type } of customUniforms) {
        if (CAPTURABLE_TYPES.has(type) && !vars.some(v => v.varName === name)) {
          vars.push({ varName: name, varType: type, declarationLine: -1 });
        }
      }
    }

    if (vars.length === 0) {
      if (!this.isCurrentRequest(requestId)) {
        return;
      }
      captureDiagEvent('EMPTY-EXIT vars.length===0 (→ "No variables in scope")', {
        resolvedLine,
        codeLen: params.code.length,
        codeHead: params.code.slice(0, 40),
        language: this.renderingEngine.getShaderLanguage?.() ?? 'glsl',
      });
      this.emitErrorState(null);
      this.finishCollection([]);
      return;
    }

    const isPixelMode = params.pixelX !== null && params.pixelY !== null;

    const { gridWidth, gridHeight } = computeGridDimensions(
      params.sampleSize,
      params.canvasWidth,
      params.canvasHeight,
    );

    const captures: Array<{ varName: string; varType: string; captureShader: string; selectorIndex?: number; hidden?: boolean; slangPlan?: DebugInstrumentationPlan }> = [];

    // Store declaration lines for each variable
    this.varDeclarationLines.clear();
    for (const v of vars) {
      this.varDeclarationLines.set(v.varName, v.declarationLine);
    }

    const buildSelectorShader = (keepTrailingSource: boolean): string | undefined =>
      params.slangCapture
        ? params.slangCapture.plan.files.find((file) => file.uri === params.slangCapture!.plan.rootUri)?.source
        : VariableCaptureBuilder.generateMultiCaptureShader(
          params.code,
          resolvedLine,
          vars,
          params.loopMaxIters,
          params.customParams,
          isPixelMode,
          gridWidth,
          gridHeight,
          keepTrailingSource,
        ) ?? undefined;

    const selectorShader = buildSelectorShader(true);

    if (selectorShader) {
      if (params.slangCapture) {
        captures.push({ varName: params.slangCapture.plan.captureSlots[0].name, varType: 'bool', captureShader: selectorShader, selectorIndex: 0, hidden: true, slangPlan: params.slangCapture.plan });
      }
      for (let index = 0; index < vars.length; index++) {
        const v = vars[index];
        captures.push({
          varName: v.varName,
          varType: v.varType,
          captureShader: selectorShader,
          selectorIndex: params.slangCapture ? index + 1 : index,
          ...(params.slangCapture ? { slangPlan: params.slangCapture.plan } : {}),
        });
      }
    }

    if (captures.length === 0) {
      if (!this.isCurrentRequest(requestId)) {
        return;
      }
      captureDiagEvent('EMPTY-EXIT selectorShader===null (→ "No variables in scope")', {
        resolvedLine,
        isPixelMode,
        varNames: vars.map(v => `${v.varName}:${v.varType}`).join(','),
        language: this.renderingEngine.getShaderLanguage?.() ?? 'glsl',
      });
      this.emitErrorState(null);
      this.finishCollection([]);
      return;
    }

    const uniforms = this.renderingEngine.getCaptureUniforms();

    // Provide custom uniform declarations + values to the capturer so capture shaders compile and render correctly
    const customDecl = this.renderingEngine.getCustomUniformDeclarations();
    const customValues = this.renderingEngine.getCurrentCustomUniforms();
    this.capturer.setCustomUniforms(customDecl, customValues);
    if (params.inputConfig) {
      this.capturer.setInputBindings(params.inputConfig);
    }

    if (!this.isCurrentRequest(requestId)) {
      return;
    }

    this.pendingResults = [];
    this.declaredOrder = captures.filter((capture) => !capture.hidden).map((capture) => capture.varName);
    this.lastGridWidth = gridWidth;
    this.lastGridHeight = gridHeight;
    this.emptyCollectFrames = 0;

    const issueCaptures = (batch: typeof captures) => isPixelMode
      ? this.capturer!.issueCaptureAtPixel(
        batch,
        params.pixelX!,
        params.pixelY!,
        params.canvasWidth,
        params.canvasHeight,
        uniforms,
        () => this.isCurrentRequest(requestId),
      )
      : this.capturer!.issueCaptureGrid(
        batch,
        uniforms,
        gridWidth,
        gridHeight,
        () => this.isCurrentRequest(requestId),
      );

    let issued = await issueCaptures(captures);

    // The capture keeps whatever follows the captured function so calls into
    // it still resolve. When that will not compile - a stray token below the
    // cut, say - fall back to the older cut that drops the rest of the file.
    if (issued === 0 && !params.slangCapture && this.isCurrentRequest(requestId)) {
      const wholeFileShader = buildSelectorShader(false);
      if (wholeFileShader && wholeFileShader !== selectorShader) {
        this.capturer.clearLastError();
        issued = await issueCaptures(
          captures.map((capture) => ({ ...capture, captureShader: wholeFileShader })),
        );
      }
    }

    if (!this.isCurrentRequest(requestId)) {
      return;
    }

    if (issued === 0) {
      const captureError = this.capturer.getLastError();
      captureDiagEvent('EMPTY-EXIT issued===0 (→ error shown)', {
        isPixelMode,
        captureError: captureError ?? '(none)',
        varCount: vars.length,
        language: this.renderingEngine.getShaderLanguage?.() ?? 'glsl',
      });
      this.clearPollTimeout();
      this.lastParams = null;
      this.emitIssues(this.capturerIssues('Failed to capture variables'));
      this.finishCollection([]);
      return;
    }

    // Some variables failed but others issued: report the failures and let the
    // successful captures complete rather than discarding the whole batch.
    if (this.capturer.getCaptureErrors().length > 0) {
      this.emitIssues(this.capturerIssues('Failed to capture some variables'));
    }

    this.expectedCount = issued;
    this.collecting = true;
    this.collectionRequestId = requestId;
    this.emitLoadingState(true);

    this.lastCaptureMode = isPixelMode ? 'pixel' : 'grid';
    this.lastCaptureLine = resolvedLine;
    this.lastCaptureFilePath = params.filePath ?? null;
    this.lastCaptureBufferName = params.activeBufferName ?? 'Image';
  }

  private decodeAndUpdate(
    results: Array<{ varName: string; varType: string; rgba: Float32Array; hidden?: boolean }>
  ): void {
    captureCounters.decodeCalls++;
    const decodeStartedAt = performance.now();
    const isPixelMode = this.lastCaptureMode === 'pixel';
    const capturedVars: CapturedVariable[] = [];

    const isScalar = (t: string) => t === 'float' || t === 'int' || t === 'bool';
    const captureProvenance = {
      captureLine: this.lastCaptureLine,
      captureFilePath: this.lastCaptureFilePath,
      captureBufferName: this.lastCaptureBufferName,
    };

    const marker = results.find((result) => result.hidden);
    if (marker && !marker.rgba.some((value, index) => index % 4 === 0 && value >= 0.5)) {
      this.emitErrorState('Selected Slang statement was not executed for this capture');
      this.finishCollection([]);
      return;
    }

    for (const result of results.filter((result) => !result.hidden)) {
      if (isPixelMode) {
        // 1×1 capture: exact component values
        const value = CaptureDecoder.decodePixel(result.rgba, result.varType);
        capturedVars.push({
          varName: result.varName,
          varType: result.varType,
          declarationLine: this.varDeclarationLines.get(result.varName) ?? 0,
          ...captureProvenance,
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
          ...captureProvenance,
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
    }

    this.emitErrorState(null);
    const decodeMs = performance.now() - decodeStartedAt;
    if (decodeMs > 8) {
      // Long synchronous decode on the main thread — a jank suspect.
      captureDiagEvent('slow decode (main-thread)', {
        decodeMs: Math.round(decodeMs * 100) / 100,
        varCount: results.length,
        mode: this.lastCaptureMode,
        gridW: this.lastGridWidth,
        gridH: this.lastGridHeight,
        expandedVars: this.expandedVars.size,
      });
    }
    this.finishCollection(capturedVars);
  }

  private noteEmptyCollectFrame(): boolean {
    this.emptyCollectFrames += 1;
    return this.emptyCollectFrames >= MAX_EMPTY_COLLECTION_FRAMES;
  }

  private finishCollection(vars: CapturedVariable[]): void {
    this.collecting = false;
    this.pendingResults = [];
    this.expectedCount = 0;
    this.emptyCollectFrames = 0;
    this.emitLoadingState(false);
    this.onUpdate(vars);
  }

  private emitLoadingState(isLoading: boolean): void {
    this.onLoadingStateChanged?.(isLoading);
  }

  private emitErrorState(error: string | null): void {
    if (error) {
      this.emitIssues([{ message: error }]);
      return;
    }
    // Clearing failures must not take the note explaining a shortened capture
    // with it: that stays true for as long as the shader is broken.
    this.emitIssues(this.capNotice ? [this.capNotice] : []);
  }

  /**
   * A capture issues one shader per variable, so the ones that worked are still
   * worth showing. The panel gets every failure with the variable it belongs
   * to, rather than a single string that hid the successes behind it.
   */
  private emitIssues(issues: CaptureIssue[]): void {
    this.onErrorChanged?.(issues);
  }

  /**
   * Every variable's capture shader is built from the same source, so a syntax
   * error in it is reported once per variable, each copy carrying Slang's
   * "compilation ceased" epilogue. Running the messages through the same
   * cleanup the renderer errors get collapses that back to what actually went
   * wrong, while keeping the variable each failure belongs to.
   */
  private capturerIssues(fallback: string): CaptureIssue[] {
    const reported = this.capturer?.getCaptureErrors() ?? [];
    if (reported.length === 0) {
      return [{ message: fallback }];
    }

    const byMessage = new Map<string, (string | undefined)[]>();
    for (const entry of reported) {
      const [cleaned] = dedupeCompilerErrors([entry.message]);
      const message = cleaned?.trim();
      if (!message) {
        continue;
      }
      byMessage.set(message, [...(byMessage.get(message) ?? []), entry.varName]);
    }

    const issues: CaptureIssue[] = [];
    for (const [message, varNames] of byMessage) {
      // A failure every variable shares is a property of the shader, not of any
      // one of them, so naming the first would be misleading.
      const [varName] = varNames;
      issues.push(varNames.length === 1 && varName !== undefined ? { varName, message } : { message });
    }
    return issues.length > 0 ? issues : [{ message: fallback }];
  }
}
