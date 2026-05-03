// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VariableCaptureManager, computeGridDimensions } from '../lib/VariableCaptureManager';
import type { CapturedVariable } from '../lib/VariableCaptureManager';
import { VariableCaptureBuilder } from '../../../debug/src/VariableCaptureBuilder';

// Mock VariableCaptureBuilder — the static methods are swapped with spies
vi.mock('../../../debug/src/VariableCaptureBuilder', () => ({
  VariableCaptureBuilder: {
    getAllInScopeVariables: vi.fn(),
    generateMultiCaptureShader: vi.fn(),
  },
}));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

// Use the exported function directly
const computeExpectedGrid = computeGridDimensions;

function makeGridData(gridWidth: number, gridHeight: number, rValue = 0.5): Float32Array {
  const totalPixels = gridWidth * gridHeight;
  const data = new Float32Array(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    data[i * 4 + 0] = rValue;
    data[i * 4 + 3] = 1.0;
  }
  return data;
}

function makeVec3GridData(gridWidth: number, gridHeight: number, r: number, g: number, b: number): Float32Array {
  const totalPixels = gridWidth * gridHeight;
  const data = new Float32Array(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 1.0;
  }
  return data;
}

// Pre-compute expected grid for BASE_PARAMS (sampleSize=64, 800×600)
const BASE_GRID = computeExpectedGrid(64, 800, 600);

const UNIFORMS = {
  time: 0, timeDelta: 0.016, frameRate: 60, frame: 1,
  res: [800, 600], mouse: [0, 0, 0, 0], date: [0, 0, 0, 0],
};

const BASE_PARAMS = {
  code: 'void mainImage(out vec4 fc, in vec2 co) { float x = 1.0; }',
  debugLine: 0 as number | null,
  pixelX: null as number | null,
  pixelY: null as number | null,
  canvasWidth: 800,
  canvasHeight: 600,
  loopMaxIters: new Map<number, number>(),
  customParams: new Map<number, string>(),
  activeBufferName: 'Image',
  filePath: '/shaders/image.glsl',
  sampleSize: 64,
  refreshMode: 'manual' as const,
  pollingMs: 500,
};

// ------------------------------------------------------------------
// computeGridDimensions unit tests
// ------------------------------------------------------------------

describe('computeGridDimensions', () => {
  it('produces square grid for square canvas', () => {
    const { gridWidth, gridHeight } = computeGridDimensions(32, 512, 512);
    expect(gridWidth).toBe(32);
    expect(gridHeight).toBe(32);
  });

  it('produces wider grid for 16:9 canvas', () => {
    const { gridWidth, gridHeight } = computeGridDimensions(32, 1920, 1080);
    expect(gridWidth).toBeGreaterThan(gridHeight);
    expect(gridWidth / gridHeight).toBeCloseTo(1920 / 1080, 0);
  });

  it('produces taller grid for 9:16 canvas', () => {
    const { gridWidth, gridHeight } = computeGridDimensions(32, 1080, 1920);
    expect(gridHeight).toBeGreaterThan(gridWidth);
  });

  it('total pixels approximately equals sampleSize squared', () => {
    const { gridWidth, gridHeight } = computeGridDimensions(64, 1920, 1080);
    const totalPixels = gridWidth * gridHeight;
    expect(totalPixels).toBeGreaterThan(64 * 64 * 0.85);
    expect(totalPixels).toBeLessThan(64 * 64 * 1.15);
  });

  it('handles extreme ultrawide (3:1)', () => {
    const { gridWidth, gridHeight } = computeGridDimensions(32, 3000, 1000);
    expect(gridWidth / gridHeight).toBeCloseTo(3.0, 0);
  });

  it('handles extreme portrait (1:3)', () => {
    const { gridWidth, gridHeight } = computeGridDimensions(32, 1000, 3000);
    expect(gridHeight / gridWidth).toBeCloseTo(3.0, 0);
  });

  it('very small sampleSize produces grid with minimum 1x1', () => {
    const { gridWidth, gridHeight } = computeGridDimensions(1, 1920, 1080);
    expect(gridWidth).toBeGreaterThanOrEqual(1);
    expect(gridHeight).toBeGreaterThanOrEqual(1);
  });

  it('returns square grid when canvas dimensions are zero', () => {
    const { gridWidth, gridHeight } = computeGridDimensions(32, 0, 0);
    expect(gridWidth).toBe(32);
    expect(gridHeight).toBe(32);
  });

  it('returns square grid when canvas dimensions are negative', () => {
    const { gridWidth, gridHeight } = computeGridDimensions(32, -100, -50);
    expect(gridWidth).toBe(32);
    expect(gridHeight).toBe(32);
  });

  it('consistent dimensions for same inputs', () => {
    const a = computeGridDimensions(64, 800, 600);
    const b = computeGridDimensions(64, 800, 600);
    expect(a.gridWidth).toBe(b.gridWidth);
    expect(a.gridHeight).toBe(b.gridHeight);
  });

  it('caps grid dimensions to the render resolution', () => {
    const { gridWidth, gridHeight } = computeGridDimensions(128, 64, 32);
    expect(gridWidth).toBeLessThanOrEqual(64);
    expect(gridHeight).toBeLessThanOrEqual(32);
  });
});

// ------------------------------------------------------------------
// Test suite
// ------------------------------------------------------------------

describe('VariableCaptureManager', () => {
  let manager: VariableCaptureManager;
  let onUpdate: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;

  let mockCollectResults: ReturnType<typeof vi.fn>;
  let mockIssueCaptureAtPixel: ReturnType<typeof vi.fn>;
  let mockIssueCaptureGrid: ReturnType<typeof vi.fn>;
  let mockCancelPendingCaptures: ReturnType<typeof vi.fn>;
  let mockCapturerDispose: ReturnType<typeof vi.fn>;
  let mockCreateVariableCapturer: ReturnType<typeof vi.fn>;
  let mockGetCaptureUniforms: ReturnType<typeof vi.fn>;
  let mockRenderingEngine: any;

  // RAF control
  let rafCallbacks: FrameRequestCallback[];
  let rafCallbackIds: number[];
  let rafId: number;

  async function flushRAF(n = 1) {
    for (let i = 0; i < n; i++) {
      const cbs = rafCallbacks.splice(0);
      rafCallbackIds.splice(0);
      for (const cb of cbs) {
        cb(performance.now());
      }
      await Promise.resolve();
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();

    rafCallbacks = [];
    rafCallbackIds = [];
    rafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      const id = ++rafId;
      rafCallbackIds.push(id);
      rafCallbacks.push(cb);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      const index = rafCallbackIds.indexOf(id);
      if (index !== -1) {
        rafCallbackIds.splice(index, 1);
        rafCallbacks.splice(index, 1);
      }
    });

    mockCollectResults = vi.fn().mockReturnValue([]);
    mockIssueCaptureAtPixel = vi.fn().mockResolvedValue(0);
    mockIssueCaptureGrid = vi.fn().mockResolvedValue(0);
    mockCancelPendingCaptures = vi.fn();
    mockCapturerDispose = vi.fn();

    const mockCapturer = {
      issueCaptureAtPixel: mockIssueCaptureAtPixel,
      issueCaptureGrid: mockIssueCaptureGrid,
      collectResults: mockCollectResults,
      cancelPendingCaptures: mockCancelPendingCaptures,
      dispose: mockCapturerDispose,
      setCustomUniforms: vi.fn(),
      setCompileContext: vi.fn(),
      clearLastError: vi.fn(),
      getLastError: vi.fn().mockReturnValue(null),
    };

    mockCreateVariableCapturer = vi.fn().mockReturnValue(mockCapturer);
    mockGetCaptureUniforms = vi.fn().mockReturnValue(UNIFORMS);

    mockRenderingEngine = {
      createVariableCapturer: mockCreateVariableCapturer,
      getVariableCaptureCompileContext: vi.fn().mockReturnValue({ commonCode: '', slotAssignments: [], channelTypes: ['2D', '2D', '2D', '2D'] }),
      getCaptureUniforms: mockGetCaptureUniforms,
      getCustomUniformInfo: vi.fn().mockReturnValue([]),
      getCustomUniformDeclarations: vi.fn().mockReturnValue(''),
      getCurrentCustomUniforms: vi.fn().mockReturnValue([]),
    };

    onUpdate = vi.fn();
    onError = vi.fn();
    manager = new VariableCaptureManager(mockRenderingEngine, onUpdate);
    manager.setErrorCallback(onError);
    (VariableCaptureBuilder.generateMultiCaptureShader as any).mockReturnValue('shader');
  });

  afterEach(() => {
    manager.dispose();
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------------
  // Loop scheduling
  // ----------------------------------------------------------------

  describe('Loop scheduling', () => {
    it('notifyStateChange schedules one RAF', async () => {
      manager.notifyStateChange(BASE_PARAMS);
      expect(rafCallbacks).toHaveLength(1);
    });

    it('stop cancels pending work and disposes the capturer', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();

      expect(mockCreateVariableCapturer).toHaveBeenCalledOnce();

      manager.stop();

      expect(mockCapturerDispose).toHaveBeenCalledOnce();

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();

      expect(mockCreateVariableCapturer).toHaveBeenCalledTimes(2);
    });

    it('second notifyStateChange while loop is running does not schedule a second RAF', async () => {
      manager.notifyStateChange(BASE_PARAMS);
      manager.notifyStateChange(BASE_PARAMS);
      expect(rafCallbacks).toHaveLength(1);
    });

    it('loop stops when no pending work (non-realtime), and notifyStateChange can restart it', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([]);

      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 500 });
      await flushRAF(); // issue → 0 vars → onUpdate([]) → no collecting

      // Loop should have stopped — no pending RAF (poll timeout scheduled instead)
      expect(rafCallbacks).toHaveLength(0);

      // Can restart after idle
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 500 });
      expect(rafCallbacks).toHaveLength(1);
    });

    it('loop continues running while collecting', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);
      // collectResults never signals — pending indefinitely
      mockCollectResults.mockReturnValue([]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF(); // issue → collecting=true
      expect(rafCallbacks).toHaveLength(1); // still running

      await flushRAF(); // collect attempt → empty → still collecting
      expect(rafCallbacks).toHaveLength(1); // loop continues
    });

    it('loop does not double-schedule when onUpdate triggers notifyStateChange', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);

      const data = makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5);
      mockCollectResults.mockReturnValue([{ varName: 'x', varType: 'float', rgba: data }]);

      // Simulate: onUpdate callback re-triggers notifyStateChange (as Svelte reactivity does)
      onUpdate.mockImplementation(() => {
        manager.notifyStateChange(BASE_PARAMS); // loopRunning should block double-scheduling
      });

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF(); // issue
      await flushRAF(); // collect → onUpdate fires → notifyStateChange called inside → should NOT add second RAF

      // Only one RAF should be pending (the one scheduled by captureLoop bottom, or by notifyStateChange)
      expect(rafCallbacks.length).toBeLessThanOrEqual(1);
    });
  });

  // ----------------------------------------------------------------
  // Mode dispatch
  // ----------------------------------------------------------------

  describe('Mode dispatch', () => {
    beforeEach(() => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
    });

    it('grid mode: issueCaptureGrid called when no pixel coords', async () => {
      mockIssueCaptureGrid.mockResolvedValue(0);

      manager.notifyStateChange({ ...BASE_PARAMS, pixelX: null, pixelY: null });
      await flushRAF();

      expect(mockIssueCaptureGrid).toHaveBeenCalledOnce();
      expect(mockIssueCaptureAtPixel).not.toHaveBeenCalled();
    });

    it('pixel mode: issueCaptureAtPixel called when pixel coords provided', async () => {
      mockIssueCaptureAtPixel.mockResolvedValue(0);

      manager.notifyStateChange({ ...BASE_PARAMS, pixelX: 400, pixelY: 300 });
      await flushRAF();

      expect(mockIssueCaptureAtPixel).toHaveBeenCalledOnce();
      expect(mockIssueCaptureGrid).not.toHaveBeenCalled();
    });

    it('pixel mode: issueCaptureAtPixel receives correct pixel coords', async () => {
      mockIssueCaptureAtPixel.mockResolvedValue(0);

      manager.notifyStateChange({ ...BASE_PARAMS, pixelX: 123, pixelY: 456, canvasWidth: 800, canvasHeight: 600 });
      await flushRAF();

      expect(mockIssueCaptureAtPixel).toHaveBeenCalledWith(
        expect.any(Array),
        123,
        456,
        800,
        600,
        UNIFORMS,
        expect.any(Function),
      );
    });

    it('debugLine=null resolves to whole-shader mode (-1)', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, debugLine: null });
      await flushRAF();

      expect(VariableCaptureBuilder.getAllInScopeVariables).toHaveBeenCalledWith(
        expect.any(String),
        -1,
      );
    });

    it('debugLine=5 passed through to getAllInScopeVariables', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, debugLine: 5 });
      await flushRAF();

      expect(VariableCaptureBuilder.getAllInScopeVariables).toHaveBeenCalledWith(
        expect.any(String),
        5,
      );
    });
  });

  // ----------------------------------------------------------------
  // Sample size
  // ----------------------------------------------------------------

  describe('Sample size', () => {
    beforeEach(() => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(0);
    });

    it('passes computed grid dimensions to issueCaptureGrid', async () => {
      const { gridWidth, gridHeight } = computeExpectedGrid(32, 800, 600);
      manager.notifyStateChange({ ...BASE_PARAMS, sampleSize: 32 });
      await flushRAF();

      expect(mockIssueCaptureGrid).toHaveBeenCalledWith(
        expect.any(Array),
        UNIFORMS,
        gridWidth,
        gridHeight,
        expect.any(Function),
      );
    });

    it('passes computed grid dimensions to generateMultiCaptureShader in grid mode', async () => {
      const { gridWidth, gridHeight } = computeExpectedGrid(16, 800, 600);
      manager.notifyStateChange({ ...BASE_PARAMS, sampleSize: 16 });
      await flushRAF();

      expect(VariableCaptureBuilder.generateMultiCaptureShader).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        [{ varName: 'x', varType: 'float' }],
        expect.any(Map),
        expect.any(Map),
        false, // grid mode → captureCoordUniform=false
        gridWidth,
        gridHeight,
      );
    });

    it('pixel mode: generateMultiCaptureShader called with captureCoordUniform=true', async () => {
      mockIssueCaptureAtPixel.mockResolvedValue(0);

      manager.notifyStateChange({ ...BASE_PARAMS, pixelX: 100, pixelY: 200 });
      await flushRAF();

      expect(VariableCaptureBuilder.generateMultiCaptureShader).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        [{ varName: 'x', varType: 'float' }],
        expect.any(Map),
        expect.any(Map),
        true, // pixel mode → captureCoordUniform=true
        expect.any(Number),
        expect.any(Number),
      );
    });
  });

  // ----------------------------------------------------------------
  // Grid dimensions and aspect ratio
  // ----------------------------------------------------------------

  describe('Grid dimensions and aspect ratio', () => {
    beforeEach(() => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(0);
    });

    it('wide canvas (16:9) produces wider-than-tall grid', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, canvasWidth: 1920, canvasHeight: 1080, sampleSize: 32 });
      await flushRAF();

      const [, , gridWidth, gridHeight] = mockIssueCaptureGrid.mock.calls[0];
      expect(gridWidth).toBeGreaterThan(gridHeight);
      // Aspect ratio should be close to 16:9
      const gridAspect = gridWidth / gridHeight;
      expect(gridAspect).toBeCloseTo(1920 / 1080, 0);
    });

    it('tall canvas (9:16) produces taller-than-wide grid', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, canvasWidth: 1080, canvasHeight: 1920, sampleSize: 32 });
      await flushRAF();

      const [, , gridWidth, gridHeight] = mockIssueCaptureGrid.mock.calls[0];
      expect(gridHeight).toBeGreaterThan(gridWidth);
    });

    it('square canvas produces square grid', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, canvasWidth: 512, canvasHeight: 512, sampleSize: 32 });
      await flushRAF();

      const [, , gridWidth, gridHeight] = mockIssueCaptureGrid.mock.calls[0];
      expect(gridWidth).toBe(gridHeight);
      expect(gridWidth).toBe(32);
    });

    it('total pixels approximately equals sampleSize squared', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, canvasWidth: 1920, canvasHeight: 1080, sampleSize: 64 });
      await flushRAF();

      const [, , gridWidth, gridHeight] = mockIssueCaptureGrid.mock.calls[0];
      const totalPixels = gridWidth * gridHeight;
      // Should be within 10% of 64*64=4096
      expect(totalPixels).toBeGreaterThan(4096 * 0.9);
      expect(totalPixels).toBeLessThan(4096 * 1.1);
    });

    it('extreme ultrawide canvas (3:1) preserves aspect ratio', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, canvasWidth: 3000, canvasHeight: 1000, sampleSize: 32 });
      await flushRAF();

      const [, , gridWidth, gridHeight] = mockIssueCaptureGrid.mock.calls[0];
      const gridAspect = gridWidth / gridHeight;
      expect(gridAspect).toBeCloseTo(3.0, 0);
    });

    it('very small sampleSize (4) still produces valid grid', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, canvasWidth: 1920, canvasHeight: 1080, sampleSize: 4 });
      await flushRAF();

      const [, , gridWidth, gridHeight] = mockIssueCaptureGrid.mock.calls[0];
      expect(gridWidth).toBeGreaterThanOrEqual(1);
      expect(gridHeight).toBeGreaterThanOrEqual(1);
    });

    it('does not sample more grid pixels than the render resolution', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, canvasWidth: 64, canvasHeight: 32, sampleSize: 128 });
      await flushRAF();

      const [, , gridWidth, gridHeight] = mockIssueCaptureGrid.mock.calls[0];
      expect(gridWidth).toBeLessThanOrEqual(64);
      expect(gridHeight).toBeLessThanOrEqual(32);
    });

    it('grid dimensions match between issueCaptureGrid and generateMultiCaptureShader', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, canvasWidth: 1600, canvasHeight: 900, sampleSize: 64 });
      await flushRAF();

      const [, , captureGridW, captureGridH] = mockIssueCaptureGrid.mock.calls[0];
      const shaderCall = (VariableCaptureBuilder.generateMultiCaptureShader as any).mock.calls[0];
      const shaderGridW = shaderCall[6]; // 7th arg = gridWidth
      const shaderGridH = shaderCall[7]; // 8th arg = gridHeight

      expect(captureGridW).toBe(shaderGridW);
      expect(captureGridH).toBe(shaderGridH);
    });
  });

  describe('Selector shader batching', () => {
    it('uses one shared selector shader for all variables when available', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([
        { varName: 'uv', varType: 'vec2', declarationLine: 1 },
        { varName: 'col', varType: 'vec3', declarationLine: 2 },
      ]);
      (VariableCaptureBuilder.generateMultiCaptureShader as any).mockReturnValue('selector shader');
      mockIssueCaptureGrid.mockResolvedValue(2);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();

      expect(VariableCaptureBuilder.generateMultiCaptureShader).toHaveBeenCalled();
      expect(mockIssueCaptureGrid).toHaveBeenCalledWith(
        [
          { varName: 'uv', varType: 'vec2', captureShader: 'selector shader', selectorIndex: 0 },
          { varName: 'col', varType: 'vec3', captureShader: 'selector shader', selectorIndex: 1 },
        ],
        UNIFORMS,
        BASE_GRID.gridWidth,
        BASE_GRID.gridHeight,
        expect.any(Function),
      );
    });

    it('does not issue captures when selector shader generation is unavailable', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([
        { varName: 'uv', varType: 'vec2', declarationLine: 1 },
        { varName: 'col', varType: 'vec3', declarationLine: 2 },
      ]);
      (VariableCaptureBuilder.generateMultiCaptureShader as any).mockReturnValue(null);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();

      expect(VariableCaptureBuilder.generateMultiCaptureShader).toHaveBeenCalledOnce();
      expect(mockIssueCaptureGrid).not.toHaveBeenCalled();
      expect(onUpdate).toHaveBeenCalledWith([]);
    });

    it('includes custom uniforms in one selector shader', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([
        { varName: 'uv', varType: 'vec2', declarationLine: 1 },
        { varName: 'col', varType: 'vec3', declarationLine: 2 },
      ]);
      mockRenderingEngine.getCustomUniformInfo.mockReturnValue([
        { name: 'customGain', type: 'float' },
      ]);
      (VariableCaptureBuilder.generateMultiCaptureShader as any).mockReturnValue('selector shader');
      mockIssueCaptureGrid.mockResolvedValue(3);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();

      expect(VariableCaptureBuilder.generateMultiCaptureShader).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        [
          { varName: 'uv', varType: 'vec2', declarationLine: 1 },
          { varName: 'col', varType: 'vec3', declarationLine: 2 },
          { varName: 'customGain', varType: 'float', declarationLine: -1 },
        ],
        expect.any(Map),
        expect.any(Map),
        false,
        BASE_GRID.gridWidth,
        BASE_GRID.gridHeight,
      );
      expect(mockIssueCaptureGrid).toHaveBeenCalledWith(
        [
          { varName: 'uv', varType: 'vec2', captureShader: 'selector shader', selectorIndex: 0 },
          { varName: 'col', varType: 'vec3', captureShader: 'selector shader', selectorIndex: 1 },
          { varName: 'customGain', varType: 'float', captureShader: 'selector shader', selectorIndex: 2 },
        ],
        UNIFORMS,
        BASE_GRID.gridWidth,
        BASE_GRID.gridHeight,
        expect.any(Function),
      );
    });
  });

  // ----------------------------------------------------------------
  // Result accumulation and ordering
  // ----------------------------------------------------------------

  describe('Result accumulation', () => {
    it('calls onUpdate([]) immediately when no variables in scope', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();

      expect(onUpdate).toHaveBeenCalledOnce();
      expect(onUpdate.mock.calls[0][0]).toEqual([]);
    });

    it('partial results do not trigger onUpdate', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([
        { varName: 'x', varType: 'float' },
        { varName: 'y', varType: 'float' },
      ]);
      mockIssueCaptureGrid.mockResolvedValue(2);

      // First collect tick: only one result
      mockCollectResults
        .mockReturnValueOnce([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight) }])
        .mockReturnValue([]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF(); // issue
      await flushRAF(); // partial collect (1/2)

      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('onUpdate fires when all expected results arrive', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([
        { varName: 'x', varType: 'float' },
        { varName: 'y', varType: 'float' },
      ]);
      mockIssueCaptureGrid.mockResolvedValue(2);

      mockCollectResults
        .mockReturnValueOnce([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight) }])
        .mockReturnValueOnce([{ varName: 'y', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight) }])
        .mockReturnValue([]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF(); // issue
      await flushRAF(); // collect x
      await flushRAF(); // collect y → all done → onUpdate

      expect(onUpdate).toHaveBeenCalledOnce();
      expect(onUpdate.mock.calls[0][0]).toHaveLength(2);
    });

    it('results are sorted by declared order regardless of GPU delivery order', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([
        { varName: 'alpha', varType: 'float' },
        { varName: 'beta', varType: 'float' },
        { varName: 'gamma', varType: 'float' },
      ]);
      mockIssueCaptureGrid.mockResolvedValue(3);

      // GPU delivers in reverse order: gamma, beta, then alpha last
      mockCollectResults
        .mockReturnValueOnce([
          { varName: 'gamma', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.9) },
          { varName: 'beta', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) },
        ])
        .mockReturnValueOnce([
          { varName: 'alpha', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.1) },
        ])
        .mockReturnValue([]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF(); // issue
      await flushRAF(); // collect gamma+beta
      await flushRAF(); // collect alpha → all done → onUpdate

      expect(onUpdate).toHaveBeenCalledOnce();
      const vars: CapturedVariable[] = onUpdate.mock.calls[0][0];
      expect(vars[0].varName).toBe('alpha');
      expect(vars[1].varName).toBe('beta');
      expect(vars[2].varName).toBe('gamma');
    });

    it('issued=0 does not start collecting or fire onUpdate', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(0); // all shaders failed to compile

      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 500 });
      await flushRAF(); // issue → issued=0 → no collecting

      expect(onUpdate).toHaveBeenCalledOnce();
      expect(onUpdate.mock.calls[0][0]).toEqual([]);
      expect(rafCallbacks).toHaveLength(0); // loop stopped (poll scheduled instead)
    });

    it('generateMultiCaptureShader returning null does not issue captures', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([
        { varName: 'x', varType: 'float' },
      ]);
      (VariableCaptureBuilder.generateMultiCaptureShader as any).mockReturnValue(null);
      mockIssueCaptureGrid.mockResolvedValue(0);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();

      expect(mockIssueCaptureGrid).not.toHaveBeenCalled();
      expect(onUpdate).toHaveBeenCalledOnce();
      expect(onUpdate.mock.calls[0][0]).toEqual([]);
    });

    it('stops collecting and clears variables after repeated empty collection frames', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);
      mockCollectResults.mockReturnValue([]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF(); // issue
      await flushRAF(120); // collect keeps returning empty

      expect(onUpdate).toHaveBeenCalledOnce();
      expect(onUpdate.mock.calls[0][0]).toEqual([]);
      expect(rafCallbacks).toHaveLength(0);
    });

    it('cancels pending collection when a newer state arrives before results are read', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);
      mockCollectResults.mockReturnValue([
        { varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight, 0.5) },
      ]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF(); // issue old request and start collecting

      manager.notifyStateChange({ ...BASE_PARAMS, code: 'void mainImage(out vec4 fc, in vec2 co) { float x = 2.0; }' });
      await flushRAF(); // should issue new request instead of collecting stale PBOs

      expect(mockCancelPendingCaptures).toHaveBeenCalledOnce();
      expect(mockCollectResults).not.toHaveBeenCalled();
      expect(mockIssueCaptureGrid).toHaveBeenCalledTimes(2);
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('marks an in-flight issue request stale and suppresses its zero-issued error', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);

      let resolveFirstIssue: (issued: number) => void = () => {};
      mockIssueCaptureGrid
        .mockImplementationOnce(() => new Promise<number>((resolve) => {
          resolveFirstIssue = resolve;
        }))
        .mockResolvedValue(1);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF(); // start first async issue

      const firstContinuation = mockIssueCaptureGrid.mock.calls[0][4] as () => boolean;
      expect(firstContinuation()).toBe(true);

      manager.notifyStateChange({ ...BASE_PARAMS, code: 'void mainImage(out vec4 fc, in vec2 co) { float x = 2.0; }' });
      expect(firstContinuation()).toBe(false);

      resolveFirstIssue(0);
      await Promise.resolve();
      await Promise.resolve();

      expect(onError).not.toHaveBeenCalledWith('Failed to capture variables');
      await flushRAF(); // issue latest request

      expect(mockIssueCaptureGrid).toHaveBeenCalledTimes(2);
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Edge cases
  // ----------------------------------------------------------------

  describe('Edge cases', () => {
    it('createVariableCapturer throwing is handled gracefully', async () => {
      mockCreateVariableCapturer.mockImplementationOnce(() => {
        throw new Error('WebGL not available');
      });
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);

      // Should not throw
      manager.notifyStateChange(BASE_PARAMS);
      await expect(flushRAF()).resolves.toBeUndefined();

      expect(onUpdate).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith('Failed to initialize variable capture');
    });

    it('surfaces capture compile errors when no shaders issue successfully', async () => {
      const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(0);
      mockCreateVariableCapturer.mockReturnValue({
        issueCaptureAtPixel: mockIssueCaptureAtPixel,
        issueCaptureGrid: mockIssueCaptureGrid,
        collectResults: mockCollectResults,
        dispose: mockCapturerDispose,
        setCustomUniforms: vi.fn(),
        setCompileContext: vi.fn(),
        clearLastError: vi.fn(),
        getLastError: vi.fn().mockReturnValue('Shader compile failed: missing saturate'),
      });

      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 500 });
      await flushRAF();

      expect(onError).toHaveBeenCalledWith('Failed to capture variables:\nShader compile failed: missing saturate');
      expect(onUpdate).toHaveBeenCalledWith([]);
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('stops polling after a partial capture compile failure', async () => {
      const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);
      mockCollectResults
        .mockReturnValueOnce([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight) }])
        .mockReturnValue([]);
      mockCreateVariableCapturer.mockReturnValue({
        issueCaptureAtPixel: mockIssueCaptureAtPixel,
        issueCaptureGrid: mockIssueCaptureGrid,
        collectResults: mockCollectResults,
        dispose: mockCapturerDispose,
        setCustomUniforms: vi.fn(),
        setCompileContext: vi.fn(),
        clearLastError: vi.fn(),
        getLastError: vi.fn().mockReturnValue('Shader compile failed: dimension mismatch'),
      });

      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 500 });
      await flushRAF();
      await flushRAF();

      expect(onError).toHaveBeenCalledWith('Failed to capture some variables:\nShader compile failed: dimension mismatch');
      expect(onUpdate).toHaveBeenCalledOnce();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('createVariableCapturer called only once (cached)', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();
      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();

      expect(mockCreateVariableCapturer).toHaveBeenCalledOnce();
    });

    it('notifyStateChange while disposed does nothing', async () => {
      manager.dispose();
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);

      manager.notifyStateChange(BASE_PARAMS);
      expect(rafCallbacks).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  // Dispose
  // ----------------------------------------------------------------

  describe('dispose', () => {
    it('cancels pending RAF', async () => {
      manager.notifyStateChange(BASE_PARAMS);
      expect(rafCallbacks).toHaveLength(1);

      manager.dispose();
      expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('calls capturer.dispose()', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF(); // creates capturer lazily
      manager.dispose();

      expect(mockCapturerDispose).toHaveBeenCalledOnce();
    });

    it('prevents RAF from being scheduled after dispose', async () => {
      manager.dispose();
      manager.notifyStateChange(BASE_PARAMS);
      expect(rafCallbacks).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  // Histogram expansion
  // ----------------------------------------------------------------

  describe('Histogram expansion', () => {
    function setupFloatCapture() {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);
    }

    it('histogram is null when var is not expanded', async () => {
      setupFloatCapture();
      mockCollectResults.mockReturnValueOnce([
        { varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) },
      ]).mockReturnValue([]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();
      await flushRAF();

      const vars: CapturedVariable[] = onUpdate.mock.calls[0][0];
      expect(vars[0].histogram).toBeNull();
    });

    it('histogram is populated when var is expanded', async () => {
      setupFloatCapture();
      // Varying values so histogram has interesting bins
      const totalPixels = BASE_GRID.gridWidth * BASE_GRID.gridHeight;
      const data = makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight, 0.0);
      for (let i = 0; i < totalPixels; i++) {
        data[i * 4] = i / totalPixels; // 0..1 gradient
      }
      mockCollectResults.mockReturnValueOnce([
        { varName: 'x', varType: 'float', rgba: data },
      ]).mockReturnValue([]);

      manager.setHistogramExpanded('x', true);
      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();
      await flushRAF();

      const vars: CapturedVariable[] = onUpdate.mock.calls[0][0];
      expect(vars[0].histogram).not.toBeNull();
      expect(vars[0].histogram!.bins).toHaveLength(20);
      expect(vars[0].histogram!.bins.reduce((a, b) => a + b, 0)).toBe(totalPixels);
    });

    it('setHistogramExpanded false removes histogram on next capture', async () => {
      setupFloatCapture();
      mockCollectResults.mockReturnValue([
        { varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) },
      ]);

      manager.setHistogramExpanded('x', true);
      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();
      await flushRAF();
      expect(onUpdate.mock.calls[0][0][0].histogram).not.toBeNull();

      manager.setHistogramExpanded('x', false);
      onUpdate.mockClear();
      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();
      await flushRAF();
      expect(onUpdate.mock.calls[0][0][0].histogram).toBeNull();
    });

    it('vec3: colorFrequencies and channelHistograms populated when expanded', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'col', varType: 'vec3' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);

      const data = makeVec3GridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.2, 0.5, 0.8);
      mockCollectResults.mockReturnValueOnce([
        { varName: 'col', varType: 'vec3', rgba: data },
      ]).mockReturnValue([]);

      manager.setHistogramExpanded('col', true);
      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();
      await flushRAF();

      const vars: CapturedVariable[] = onUpdate.mock.calls[0][0];
      expect(vars[0].colorFrequencies).not.toBeNull();
      expect(vars[0].channelHistograms).not.toBeNull();
      expect(vars[0].channelHistograms).toHaveLength(3);
    });

    it('vec3: colorFrequencies null when not expanded', async () => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'col', varType: 'vec3' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);

      mockCollectResults.mockReturnValueOnce([
        { varName: 'col', varType: 'vec3', rgba: makeVec3GridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.2, 0.5, 0.8) },
      ]).mockReturnValue([]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF();
      await flushRAF();

      const vars: CapturedVariable[] = onUpdate.mock.calls[0][0];
      expect(vars[0].colorFrequencies).toBeNull();
      expect(vars[0].channelHistograms).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // Grid mode decoding
  // ----------------------------------------------------------------

  describe('Grid mode decoding', () => {
    async function setupCapture(varName: string, varType: string, data: Float32Array) {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName, varType }]);
      mockIssueCaptureGrid.mockResolvedValue(1);
      mockCollectResults.mockReturnValueOnce([
        { varName, varType, rgba: data },
      ]).mockReturnValue([]);

      manager.notifyStateChange(BASE_PARAMS);
      await flushRAF(); // issue
      await flushRAF(); // collect

      expect(onUpdate).toHaveBeenCalledOnce();
      return onUpdate.mock.calls[0][0][0] as CapturedVariable;
    }

    it('float: value is null, stats has min/max/mean', async () => {
      const data = makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5);
      const v = await setupCapture('x', 'float', data);

      expect(v.value).toBeNull();
      expect(v.stats).not.toBeNull();
      expect(v.stats!.mean).toBeCloseTo(0.5, 5);
      expect(v.stats!.min).toBeCloseTo(0.5, 5);
      expect(v.stats!.max).toBeCloseTo(0.5, 5);
    });

    it('stores the capture provenance needed for large variable previews', async () => {
      const data = makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5);
      const v = await setupCapture('x', 'float', data);

      expect(v.captureLine).toBe(0);
      expect(v.captureBufferName).toBe('Image');
      expect(v.captureFilePath).toBe('/shaders/image.glsl');
    });

    it('float: thumbnail has correct size (gridWidth×gridHeight×4 bytes)', async () => {
      const data = makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight, 0.5);
      const v = await setupCapture('x', 'float', data);

      expect(v.thumbnail).not.toBeNull();
      expect(v.thumbnail!.length).toBe(BASE_GRID.gridWidth * BASE_GRID.gridHeight * 4);
      expect(v.gridWidth).toBe(BASE_GRID.gridWidth);
      expect(v.gridHeight).toBe(BASE_GRID.gridHeight);
    });

    it('float thumbnail: raw clamp — 0.5 maps to ~128', async () => {
      const data = makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5);
      const v = await setupCapture('x', 'float', data);

      const thumb = v.thumbnail!;
      // Scalar: R=G=B=clamp(0.5)*255 = 128, A=255
      expect(thumb[0]).toBe(128);
      expect(thumb[1]).toBe(128);
      expect(thumb[2]).toBe(128);
      expect(thumb[3]).toBe(255);
    });

    it('float thumbnail: value > 1 clamps to white (255)', async () => {
      const data = makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,2.0); // way above 1.0
      const v = await setupCapture('x', 'float', data);

      expect(v.thumbnail![0]).toBe(255);
    });

    it('float thumbnail: value < 0 clamps to black (0)', async () => {
      const data = makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,-1.0); // below 0
      const v = await setupCapture('x', 'float', data);

      expect(v.thumbnail![0]).toBe(0);
    });

    it('vec3 thumbnail: preserves RGB channels', async () => {
      const data = makeVec3GridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,1.0, 0.0, 0.5);
      const v = await setupCapture('col', 'vec3', data);

      const thumb = v.thumbnail!;
      expect(thumb[0]).toBe(255); // R=1.0 → 255
      expect(thumb[1]).toBe(0);   // G=0.0 → 0
      expect(thumb[2]).toBe(128); // B=0.5 → 128
      expect(thumb[3]).toBe(255); // A always 255
    });

    it('thumbnail reverses rows so WebGL bottom-to-top maps to canvas top-to-bottom', async () => {
      const { gridWidth, gridHeight } = BASE_GRID;
      const totalPixels = gridWidth * gridHeight;
      const data = new Float32Array(totalPixels * 4);
      for (let y = 0; y < gridHeight; y++) {
        const isBottomRow = y === 0;
        const r = isBottomRow ? 1.0 : 0.0;
        const g = isBottomRow ? 0.0 : 1.0;
        for (let x = 0; x < gridWidth; x++) {
          const idx = (y * gridWidth + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = 0.0;
          data[idx + 3] = 1.0;
        }
      }
      const v = await setupCapture('col', 'vec3', data);

      const thumb = v.thumbnail!;
      const rowStride = gridWidth * 4;
      // After row reversal, thumbnail top row (y=0) should come from WebGL top row (y=gridHeight-1)
      expect(thumb[0]).toBe(0);   // R
      expect(thumb[1]).toBe(255); // G
      expect(thumb[2]).toBe(0);   // B
      expect(thumb[3]).toBe(255); // A
      // thumbnail bottom row should come from WebGL bottom row (y=0)
      const bottomRowStart = (gridHeight - 1) * rowStride;
      expect(thumb[bottomRowStart + 0]).toBe(255); // R
      expect(thumb[bottomRowStart + 1]).toBe(0);   // G
      expect(thumb[bottomRowStart + 2]).toBe(0);   // B
      expect(thumb[bottomRowStart + 3]).toBe(255); // A
    });

    it('vec3: channelMeans computed correctly', async () => {
      const data = makeVec3GridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.2, 0.5, 0.8);
      const v = await setupCapture('col', 'vec3', data);

      expect(v.channelMeans).not.toBeNull();
      expect(v.channelMeans!).toHaveLength(3);
      expect(v.channelMeans![0]).toBeCloseTo(0.2, 5);
      expect(v.channelMeans![1]).toBeCloseTo(0.5, 5);
      expect(v.channelMeans![2]).toBeCloseTo(0.8, 5);
    });

    it('vec3: channelStats has one entry per channel', async () => {
      const data = makeVec3GridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.2, 0.5, 0.8);
      const v = await setupCapture('col', 'vec3', data);

      expect(v.channelStats).toHaveLength(3);
      expect(v.channelStats![0].mean).toBeCloseTo(0.2, 5);
    });

    it('thumbnail uses computed grid dimensions from sampleSize', async () => {
      const grid32 = computeExpectedGrid(32, 800, 600);
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);
      mockCollectResults.mockReturnValueOnce([
        { varName: 'x', varType: 'float', rgba: makeGridData(grid32.gridWidth, grid32.gridHeight, 0.5) },
      ]).mockReturnValue([]);

      manager.notifyStateChange({ ...BASE_PARAMS, sampleSize: 32 });
      await flushRAF();
      await flushRAF();

      const vars: CapturedVariable[] = onUpdate.mock.calls[0][0];
      expect(vars[0].thumbnail!.length).toBe(grid32.gridWidth * grid32.gridHeight * 4);
      expect(vars[0].gridWidth).toBe(grid32.gridWidth);
      expect(vars[0].gridHeight).toBe(grid32.gridHeight);
    });
  });

  // ----------------------------------------------------------------
  // Pixel mode decoding
  // ----------------------------------------------------------------

  describe('Pixel mode decoding', () => {
    async function setupPixelCapture(varName: string, varType: string, rgba: Float32Array) {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName, varType }]);
      mockIssueCaptureAtPixel.mockResolvedValue(1);
      mockCollectResults.mockReturnValueOnce([
        { varName, varType, rgba },
      ]).mockReturnValue([]);

      manager.notifyStateChange({ ...BASE_PARAMS, pixelX: 100, pixelY: 200 });
      await flushRAF();
      await flushRAF();

      expect(onUpdate).toHaveBeenCalledOnce();
      return onUpdate.mock.calls[0][0][0] as CapturedVariable;
    }

    it('float: value=[R], no stats, no thumbnail', async () => {
      const v = await setupPixelCapture('x', 'float', new Float32Array([0.42, 0, 0, 0]));

      expect(v.value![0]).toBeCloseTo(0.42, 5);
      expect(v.stats).toBeNull();
      expect(v.thumbnail).toBeNull();
      expect(v.channelMeans).toBeNull();
    });

    it('vec3: value=[R,G,B]', async () => {
      const v = await setupPixelCapture('col', 'vec3', new Float32Array([0.1, 0.5, 0.9, 0]));

      expect(v.value).toHaveLength(3);
      expect(v.value![0]).toBeCloseTo(0.1, 5);
      expect(v.value![1]).toBeCloseTo(0.5, 5);
      expect(v.value![2]).toBeCloseTo(0.9, 5);
    });

    it('vec4: value=[R,G,B,A]', async () => {
      const v = await setupPixelCapture('c', 'vec4', new Float32Array([0.1, 0.2, 0.3, 0.4]));

      expect(v.value).toHaveLength(4);
    });

    it('bool=true: value=[1.0]', async () => {
      const v = await setupPixelCapture('flag', 'bool', new Float32Array([1.0, 0, 0, 0]));

      expect(v.value).toEqual([1.0]);
    });
  });

  // ----------------------------------------------------------------
  // Poll interval
  // ----------------------------------------------------------------

  describe('Poll interval', () => {
    let scheduledTimeouts: Array<{ id: number; callback: () => void; delay: number }>;
    let nextTimeoutId: number;

    function fireNextTimeout() {
      const next = scheduledTimeouts.shift();
      next?.callback();
    }

    beforeEach(() => {
      scheduledTimeouts = [];
      nextTimeoutId = 1;
      vi.spyOn(window, 'setTimeout').mockImplementation(((
        callback: TimerHandler,
        delay?: number,
      ): number => {
        const wrapped: () => void = typeof callback === 'function' ? callback as () => void : () => {};
        const id = nextTimeoutId++;
        scheduledTimeouts.push({ id, callback: wrapped, delay: delay ?? 0 });
        return id;
      }) as unknown as typeof window.setTimeout);
      vi.spyOn(window, 'clearTimeout').mockImplementation(((timeoutId: number | undefined): void => {
        scheduledTimeouts = scheduledTimeouts.filter(({ id }) => id !== timeoutId);
      }) as unknown as typeof window.clearTimeout);
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);
      mockCollectResults
        .mockReturnValueOnce([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) }])
        .mockReturnValue([]);
    });

    afterEach(() => {
      scheduledTimeouts = [];
    });

    it('manual mode: no setTimeout scheduled after capture completes', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'manual' as const });
      await flushRAF(); // issue
      await flushRAF(); // collect → done

      expect(scheduledTimeouts).toHaveLength(0);
      expect(rafCallbacks).toHaveLength(0); // loop stopped
    });

    it('polling mode: setTimeout scheduled after capture completes', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 1000 });
      await flushRAF(); // issue
      await flushRAF(); // collect → done → schedule poll

      expect(scheduledTimeouts).toHaveLength(1);
      expect(scheduledTimeouts[0].delay).toBe(1000);
    });

    it('polling mode: capture re-issues after timeout fires', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 1000 });
      await flushRAF(); // issue
      mockCollectResults.mockReturnValue([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) }]);
      await flushRAF(); // collect → done → schedule poll

      fireNextTimeout();

      // A new RAF should have been requested
      expect(rafCallbacks).toHaveLength(1);
      await flushRAF(); // issue second capture
      expect(mockIssueCaptureGrid).toHaveBeenCalledTimes(2);
    });

    it('dispose clears pending poll timeout', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 2000 });
      await flushRAF(); // issue
      mockCollectResults.mockReturnValue([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) }]);
      await flushRAF(); // collect → done → schedule poll

      expect(scheduledTimeouts).toHaveLength(1);
      manager.dispose();

      expect(scheduledTimeouts).toHaveLength(0);
      expect(mockIssueCaptureGrid).toHaveBeenCalledTimes(1); // no second issue
    });

    it('notifyStateChange cancels stale poll timeout before scheduling new one', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 2000 });
      await flushRAF(); // issue
      mockCollectResults.mockReturnValue([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) }]);
      await flushRAF(); // collect → done → schedule poll timeout

      // New state change arrives before timeout fires — old timeout should be cancelled
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 1000 });

      expect(scheduledTimeouts).toHaveLength(0);
    });

    it('switching from polling to manual cancels pending poll timeout', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 2000 });
      await flushRAF(); // issue
      mockCollectResults.mockReturnValue([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) }]);
      await flushRAF(); // collect → done → schedule poll

      // Switch to manual — should cancel the poll timeout
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'manual' as const });

      expect(scheduledTimeouts).toHaveLength(0);
      expect(mockIssueCaptureGrid).toHaveBeenCalledTimes(1);
    });

    it('switching from polling to pause cancels pending poll timeout', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 2000 });
      await flushRAF(); // issue
      mockCollectResults.mockReturnValue([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) }]);
      await flushRAF(); // collect → done → schedule poll

      // Switch to pause — should cancel poll and NOT issue new capture
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'pause' as const });
      expect(scheduledTimeouts).toHaveLength(0);
      expect(mockIssueCaptureGrid).toHaveBeenCalledTimes(1); // only the first capture
    });

    it('changing pollingMs mid-poll uses new interval', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 2000 });
      await flushRAF(); // issue
      mockCollectResults.mockReturnValue([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) }]);
      await flushRAF(); // collect → done → schedule poll at 2000ms

      // Before old timeout fires, change to 500ms
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 500 });
      await flushRAF(); // issue
      mockCollectResults.mockReturnValue([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) }]);
      await flushRAF(); // collect → done → schedule poll at 500ms

      expect(scheduledTimeouts).toHaveLength(1);
      expect(scheduledTimeouts[0].delay).toBe(500);
    });
  });

  // ----------------------------------------------------------------
  // Pause mode (refreshMode = 'pause')
  // ----------------------------------------------------------------

  describe('Pause mode', () => {
    beforeEach(() => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);
    });

    it('pause mode: notifyStateChange does not schedule RAF', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'pause' as const });
      expect(rafCallbacks).toHaveLength(0);
    });

    it('pause mode: no captures issued', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'pause' as const });
      expect(mockIssueCaptureGrid).not.toHaveBeenCalled();
      expect(mockIssueCaptureAtPixel).not.toHaveBeenCalled();
    });

    it('switching from paused to manual triggers capture', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'pause' as const });
      expect(rafCallbacks).toHaveLength(0);

      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'manual' as const });
      expect(rafCallbacks).toHaveLength(1);
    });

    it('switching from paused to polling triggers capture', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'pause' as const });
      expect(rafCallbacks).toHaveLength(0);

      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'polling' as const, pollingMs: 500 });
      expect(rafCallbacks).toHaveLength(1);
    });

    it('switching from paused to realtime triggers capture', async () => {
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'pause' as const });
      expect(rafCallbacks).toHaveLength(0);

      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'realtime' as const });
      expect(rafCallbacks).toHaveLength(1);
    });

    it('switching from pause to realtime starts continuous captures', async () => {
      mockCollectResults.mockReturnValue([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) }]);

      // Start in pause — nothing happens
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'pause' as const });
      expect(mockIssueCaptureGrid).not.toHaveBeenCalled();

      // Switch to realtime — should start capturing
      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'realtime' as const });
      await flushRAF(); // issue
      await flushRAF(); // collect → re-mark dirty (realtime)

      expect(mockIssueCaptureGrid).toHaveBeenCalled();
      expect(rafCallbacks).toHaveLength(1); // loop continues (realtime)
    });
  });

  // ----------------------------------------------------------------
  // Realtime capture mode (refreshMode = 'realtime')
  // ----------------------------------------------------------------

  describe('Realtime capture mode', () => {
    beforeEach(() => {
      (VariableCaptureBuilder.getAllInScopeVariables as any).mockReturnValue([{ varName: 'x', varType: 'float' }]);
      mockIssueCaptureGrid.mockResolvedValue(1);
    });

    it('realtime mode: loop continues running after capture completes', async () => {
      mockCollectResults.mockReturnValue([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) }]);

      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'realtime' as const });
      await flushRAF(); // issue
      await flushRAF(); // collect → done → realtime re-marks dirty

      expect(rafCallbacks).toHaveLength(1); // loop continues
    });

    it('realtime mode: re-issues captures continuously', async () => {
      mockCollectResults.mockReturnValue([{ varName: 'x', varType: 'float', rgba: makeGridData(BASE_GRID.gridWidth, BASE_GRID.gridHeight,0.5) }]);

      manager.notifyStateChange({ ...BASE_PARAMS, refreshMode: 'realtime' as const });
      await flushRAF(); // issue #1
      await flushRAF(); // collect #1 → re-mark dirty
      await flushRAF(); // issue #2

      expect(mockIssueCaptureGrid).toHaveBeenCalledTimes(2);
    });
  });
});
