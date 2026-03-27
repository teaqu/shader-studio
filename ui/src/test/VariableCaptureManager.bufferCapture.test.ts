import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VariableCaptureManager } from '../lib/VariableCaptureManager';
import type { RenderingEngine } from '../../../rendering/src/types';
import type { ConfigInput } from '@shader-studio/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BUFFER_A_CODE = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float d = length(fragCoord / iResolution.xy - 0.5);
  vec3 col = vec3(d);
  fragColor = vec4(col, 1.0);
}`;

const BUFFER_A_INPUTS: Record<string, ConfigInput> = {
  iChannel0: { type: 'texture', path: 'noise.png' },
};

function makeCompileContext() {
  return { commonCode: '', slotAssignments: [], channelTypes: ['2D', '2D', '2D', '2D'] };
}

function makeUniforms() {
  return { time: 1.0, res: [800, 600, 1] as [number, number, number] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VariableCaptureManager — buffer capture', () => {
  let manager: VariableCaptureManager;
  let mockCapturer: any;
  let mockRenderingEngine: RenderingEngine;
  let onUpdate: ReturnType<typeof vi.fn>;

  // RAF mocking
  let rafCallbacks: FrameRequestCallback[];
  let rafId: number;

  function flushRAF(n = 1) {
    for (let i = 0; i < n; i++) {
      const cbs = rafCallbacks.splice(0);
      for (const cb of cbs) {
        cb(performance.now());
      }
    }
  }

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    mockCapturer = {
      setCompileContext: vi.fn(),
      setCustomUniforms: vi.fn(),
      setInputBindings: vi.fn(),
      issueCaptureGrid: vi.fn().mockReturnValue(1),
      issueCaptureAtPixel: vi.fn().mockReturnValue(1),
      collectResults: vi.fn().mockReturnValue([]),
      clearLastError: vi.fn(),
      dispose: vi.fn(),
    };

    mockRenderingEngine = {
      createVariableCapturer: vi.fn().mockReturnValue(mockCapturer),
      getVariableCaptureCompileContext: vi.fn().mockReturnValue(makeCompileContext()),
      getCaptureUniforms: vi.fn().mockReturnValue(makeUniforms()),
      getCustomUniformInfo: vi.fn().mockReturnValue([]),
      getCustomUniformDeclarations: vi.fn().mockReturnValue(''),
      getCurrentCustomUniforms: vi.fn().mockReturnValue([]),
    } as any;

    onUpdate = vi.fn();
    manager = new VariableCaptureManager(mockRenderingEngine, onUpdate);
  });

  afterEach(() => {
    manager.dispose();
    vi.restoreAllMocks();
  });

  const BASE_PARAMS = {
    code: BUFFER_A_CODE,
    debugLine: 1,
    pixelX: null,
    pixelY: null,
    canvasWidth: 800,
    canvasHeight: 600,
    loopMaxIters: new Map<number, number>(),
    customParams: new Map<number, string>(),
    sampleSize: 32,
    refreshMode: 'manual' as const,
    pollingMs: 0,
  };

  // -------------------------------------------------------------------------
  describe('setInputBindings called when inputConfig is present', () => {
    it('calls setInputBindings on the capturer when inputConfig is provided', () => {
      manager.notifyStateChange({ ...BASE_PARAMS, inputConfig: BUFFER_A_INPUTS });
      flushRAF();
      expect(mockCapturer.setInputBindings).toHaveBeenCalledWith(BUFFER_A_INPUTS);
    });

    it('calls setInputBindings before issuing captures', () => {
      const callOrder: string[] = [];
      mockCapturer.setInputBindings.mockImplementation(() => callOrder.push('setInputBindings'));
      mockCapturer.issueCaptureGrid.mockImplementation(() => {
        callOrder.push('issueCaptureGrid'); return 1; 
      });

      manager.notifyStateChange({ ...BASE_PARAMS, inputConfig: BUFFER_A_INPUTS });
      flushRAF();

      const bindIdx = callOrder.indexOf('setInputBindings');
      const issueIdx = callOrder.indexOf('issueCaptureGrid');
      expect(bindIdx).toBeGreaterThanOrEqual(0);
      expect(issueIdx).toBeGreaterThan(bindIdx);
    });

    it('does NOT call setInputBindings when inputConfig is absent', () => {
      manager.notifyStateChange(BASE_PARAMS); // no inputConfig field
      flushRAF();
      expect(mockCapturer.setInputBindings).not.toHaveBeenCalled();
    });

    it('does NOT call setInputBindings when inputConfig is undefined', () => {
      manager.notifyStateChange({ ...BASE_PARAMS, inputConfig: undefined });
      flushRAF();
      expect(mockCapturer.setInputBindings).not.toHaveBeenCalled();
    });

    it('passes the exact inputConfig object to setInputBindings', () => {
      const inputs: Record<string, ConfigInput> = {
        iChannel0: { type: 'buffer', source: 'BufferA' },
        iChannel1: { type: 'texture', path: 'lut.png' },
      };
      manager.notifyStateChange({ ...BASE_PARAMS, inputConfig: inputs });
      flushRAF();
      expect(mockCapturer.setInputBindings).toHaveBeenCalledWith(inputs);
    });

    it('uses updated inputConfig on subsequent notifyStateChange calls', () => {
      manager.notifyStateChange({ ...BASE_PARAMS, inputConfig: BUFFER_A_INPUTS });
      flushRAF();

      const newInputs: Record<string, ConfigInput> = { iChannel0: { type: 'keyboard' } };
      // Wait for first collection to finish before issuing another
      mockCapturer.collectResults.mockReturnValueOnce([{ varName: 'd', varType: 'float', rgba: new Float32Array(4) }]);
      flushRAF(); // finish first batch
      flushRAF(); // trigger decode

      manager.notifyStateChange({ ...BASE_PARAMS, inputConfig: newInputs });
      flushRAF();
      expect(mockCapturer.setInputBindings).toHaveBeenLastCalledWith(newInputs);
    });
  });

  // -------------------------------------------------------------------------
  describe('capture shader uses buffer code', () => {
    it('passes buffer code to getVariableCaptureCompileContext', () => {
      manager.notifyStateChange({ ...BASE_PARAMS, code: BUFFER_A_CODE });
      flushRAF();
      expect(mockRenderingEngine.getVariableCaptureCompileContext).toHaveBeenCalledWith(BUFFER_A_CODE);
    });

    it('getVariableCaptureCompileContext is called with whatever code is in params', () => {
      const customCode = 'float sdf(vec2 p, float r) { return length(p) - r; }';
      manager.notifyStateChange({ ...BASE_PARAMS, code: customCode });
      flushRAF();
      expect(mockRenderingEngine.getVariableCaptureCompileContext).toHaveBeenCalledWith(customCode);
    });
  });

  // -------------------------------------------------------------------------
  describe('setInputBindings called on newly created capturer', () => {
    it('calls setInputBindings on a freshly created capturer', () => {
      // capturer is created lazily on first capture
      expect(mockRenderingEngine.createVariableCapturer).not.toHaveBeenCalled();

      manager.notifyStateChange({ ...BASE_PARAMS, inputConfig: BUFFER_A_INPUTS });
      flushRAF();

      expect(mockRenderingEngine.createVariableCapturer).toHaveBeenCalledTimes(1);
      expect(mockCapturer.setInputBindings).toHaveBeenCalledWith(BUFFER_A_INPUTS);
    });

    it('calls setInputBindings again on subsequent captures with new inputConfig', () => {
      manager.notifyStateChange({ ...BASE_PARAMS, inputConfig: BUFFER_A_INPUTS });
      flushRAF();
      // Finish collection
      mockCapturer.collectResults.mockReturnValueOnce([{ varName: 'd', varType: 'float', rgba: new Float32Array(4) }]);
      flushRAF();
      flushRAF();

      const newInputs: Record<string, ConfigInput> = { iChannel0: { type: 'keyboard' } };
      manager.notifyStateChange({ ...BASE_PARAMS, inputConfig: newInputs });
      flushRAF();

      expect(mockCapturer.setInputBindings).toHaveBeenCalledTimes(2);
      expect(mockCapturer.setInputBindings).toHaveBeenNthCalledWith(1, BUFFER_A_INPUTS);
      expect(mockCapturer.setInputBindings).toHaveBeenNthCalledWith(2, newInputs);
    });
  });

  // -------------------------------------------------------------------------
  describe('backwards compatibility — no inputConfig', () => {
    it('works correctly without inputConfig (Image pass debugging unchanged)', () => {
      const imageParams = {
        ...BASE_PARAMS,
        debugLine: 1,
        code: `void mainImage(out vec4 f, in vec2 c) {
  float t = iTime;
  f = vec4(t);
}`,
      };
      expect(() => {
        manager.notifyStateChange(imageParams);
        flushRAF();
      }).not.toThrow();
      expect(mockCapturer.setInputBindings).not.toHaveBeenCalled();
      expect(mockCapturer.issueCaptureGrid).toHaveBeenCalled();
    });
  });
});
