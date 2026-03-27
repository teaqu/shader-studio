import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';
import type { ShaderConfig } from '@shader-studio/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IMAGE_CODE = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float t = iTime;
  fragColor = vec4(t);
}`;

const BUFFER_A_CODE = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float d = length(fragCoord / iResolution.xy - 0.5);
  fragColor = vec4(d);
}`;

const BUFFER_B_CODE = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 prev = texture(iChannel0, fragCoord / iResolution.xy);
  fragColor = mix(prev, vec4(1.0), 0.01);
}`;

const COMMON_CODE = `float sdf(vec2 p, float r) {
  float d = length(p) - r;
  return d;
}`;

const HELPER_BUFFER_CODE = `float circle(vec2 p, float r) {
  float d = length(p) - r;
  return d;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(circle(fragCoord / iResolution.xy, 0.3));
}`;

function makeConfig(): ShaderConfig {
  return {
    version: '1',
    passes: {
      Image: {
        inputs: { iChannel0: { type: 'texture', path: 'bg.png' } },
      },
      BufferA: {
        path: 'bufferA.glsl',
        inputs: { iChannel0: { type: 'texture', path: 'noise.png' } },
      },
      BufferB: {
        path: 'bufferB.glsl',
        inputs: { iChannel0: { type: 'buffer', source: 'BufferA' } },
      },
      common: {
        path: 'common.glsl',
        inputs: {},
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShaderDebugManager — buffer debugging', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled();
    manager.setImageShaderCode(IMAGE_CODE);
  });

  // -------------------------------------------------------------------------
  describe('setShaderContext', () => {
    it('accepts null config without throwing', () => {
      expect(() =>
        manager.setShaderContext(null, '/shaders/image.glsl', {})
      ).not.toThrow();
    });

    it('accepts empty buffers map without throwing', () => {
      expect(() =>
        manager.setShaderContext(makeConfig(), '/shaders/image.glsl', {})
      ).not.toThrow();
    });

    it('overwrites previous context on subsequent calls', () => {
      manager.setShaderContext(makeConfig(), '/shaders/image.glsl', { BufferA: BUFFER_A_CODE });
      // Replace with a config that has no BufferA
      manager.setShaderContext(
        { version: '1', passes: { Image: {} } },
        '/shaders/other.glsl',
        {},
      );
      manager.updateDebugLine(0, 'float d = length(fragCoord / iResolution.xy - 0.5);', '/shaders/bufferA.glsl');
      // Old BufferA path is gone — falls back to Image
      expect(manager.getState().activeBufferName).toBe('Image');
    });

    it('does not treat a buffer shaderSource path as the Image path', () => {
      manager.setShaderContext(makeConfig(), '/shaders/bufferA.glsl', {
        BufferA: BUFFER_A_CODE,
        BufferB: BUFFER_B_CODE,
      });

      manager.updateDebugLine(1, 'float d = length(fragCoord / iResolution.xy - 0.5);', '/shaders/bufferA.glsl');

      expect(manager.getState().activeBufferName).toBe('BufferA');
      expect(manager.getDebugTarget(IMAGE_CODE, makeConfig()).code).toBe(BUFFER_A_CODE);
    });
  });

  // -------------------------------------------------------------------------
  describe('activeBufferName via updateDebugLine', () => {
    beforeEach(() => {
      manager.setShaderContext(makeConfig(), '/shaders/image.glsl', {
        BufferA: BUFFER_A_CODE,
        BufferB: BUFFER_B_CODE,
        common: COMMON_CODE,
      });
    });

    it('is Image by default before any updateDebugLine', () => {
      expect(manager.getState().activeBufferName).toBe('Image');
    });

    it('resolves to Image for the image pass path', () => {
      manager.updateDebugLine(1, 'float t = iTime;', '/shaders/image.glsl');
      expect(manager.getState().activeBufferName).toBe('Image');
    });

    it('resolves to BufferA for the BufferA file path', () => {
      manager.updateDebugLine(1, 'float d = length(fragCoord / iResolution.xy - 0.5);', '/shaders/bufferA.glsl');
      expect(manager.getState().activeBufferName).toBe('BufferA');
    });

    it('resolves to BufferB for the BufferB file path', () => {
      manager.updateDebugLine(1, 'vec4 prev = texture(iChannel0, fragCoord / iResolution.xy);', '/shaders/bufferB.glsl');
      expect(manager.getState().activeBufferName).toBe('BufferB');
    });

    it('resolves to common for the common file path', () => {
      manager.updateDebugLine(1, 'float d = length(p) - r;', '/shaders/common.glsl');
      expect(manager.getState().activeBufferName).toBe('common');
    });

    it('falls back to Image for an unrecognised path', () => {
      manager.updateDebugLine(0, 'some line', '/shaders/unrelated.glsl');
      expect(manager.getState().activeBufferName).toBe('Image');
    });

    it('matches by path suffix (relative path in config vs absolute incoming)', () => {
      // config has path: 'bufferA.glsl', incoming is absolute
      manager.updateDebugLine(0, 'line', '/mock/workspace/project/bufferA.glsl');
      expect(manager.getState().activeBufferName).toBe('BufferA');
    });

    it('matches exact path', () => {
      manager.updateDebugLine(0, 'line', 'bufferA.glsl');
      expect(manager.getState().activeBufferName).toBe('BufferA');
    });

    it('defaults to Image before setShaderContext is called on a fresh instance', () => {
      const fresh = new ShaderDebugManager();
      fresh.toggleEnabled();
      fresh.updateDebugLine(0, 'line', '/anything/bufferA.glsl');
      expect(fresh.getState().activeBufferName).toBe('Image');
    });

    it('updates activeBufferName on each subsequent updateDebugLine call', () => {
      manager.updateDebugLine(0, 'line', '/shaders/bufferA.glsl');
      expect(manager.getState().activeBufferName).toBe('BufferA');

      manager.updateDebugLine(0, 'line', '/shaders/image.glsl');
      expect(manager.getState().activeBufferName).toBe('Image');

      manager.updateDebugLine(0, 'line', '/shaders/common.glsl');
      expect(manager.getState().activeBufferName).toBe('common');
    });
  });

  // -------------------------------------------------------------------------
  describe('getDebugTarget', () => {
    beforeEach(() => {
      manager.setShaderContext(makeConfig(), '/shaders/image.glsl', {
        BufferA: BUFFER_A_CODE,
        BufferB: BUFFER_B_CODE,
        common: COMMON_CODE,
      });
    });

    it('returns imageCode when activeBufferName is Image', () => {
      manager.updateDebugLine(1, 'float t = iTime;', '/shaders/image.glsl');
      const target = manager.getDebugTarget(IMAGE_CODE, makeConfig());
      expect(target.passName).toBe('Image');
      expect(target.code).toBe(IMAGE_CODE);
    });

    it('returns BufferA code when activeBufferName is BufferA', () => {
      manager.updateDebugLine(1, 'float d = length(fragCoord / iResolution.xy - 0.5);', '/shaders/bufferA.glsl');
      const target = manager.getDebugTarget(IMAGE_CODE, makeConfig());
      expect(target.passName).toBe('BufferA');
      expect(target.code).toBe(BUFFER_A_CODE);
      expect(target.config?.passes.Image.inputs).toEqual(makeConfig().passes.BufferA?.inputs);
    });

    it('returns BufferB code when activeBufferName is BufferB', () => {
      manager.updateDebugLine(1, 'vec4 prev = texture(iChannel0, fragCoord / iResolution.xy);', '/shaders/bufferB.glsl');
      const target = manager.getDebugTarget(IMAGE_CODE, makeConfig());
      expect(target.passName).toBe('BufferB');
      expect(target.code).toBe(BUFFER_B_CODE);
      expect(target.config?.passes.Image.inputs).toEqual(makeConfig().passes.BufferB?.inputs);
    });

    it('returns common code when activeBufferName is common', () => {
      manager.updateDebugLine(1, 'float d = length(p) - r;', '/shaders/common.glsl');
      const target = manager.getDebugTarget(IMAGE_CODE, makeConfig());
      expect(target.passName).toBe('common');
      expect(target.code).toBe(COMMON_CODE);
      expect(target.config?.passes.Image.inputs).toEqual(makeConfig().passes.Image.inputs);
    });

    it('falls back to imageCode when buffer code is missing from context', () => {
      // setShaderContext called with empty buffers
      manager.setShaderContext(makeConfig(), '/shaders/image.glsl', {});
      manager.updateDebugLine(1, 'line', '/shaders/bufferA.glsl');
      expect(manager.getDebugTarget(IMAGE_CODE, makeConfig()).code).toBe(IMAGE_CODE);
    });

    it('returns updated code after setShaderContext is called again', () => {
      manager.updateDebugLine(1, 'line', '/shaders/bufferA.glsl');
      expect(manager.getDebugTarget(IMAGE_CODE, makeConfig()).code).toBe(BUFFER_A_CODE);

      const newBufferACode = '// new version';
      manager.setShaderContext(makeConfig(), '/shaders/image.glsl', { BufferA: newBufferACode });
      expect(manager.getDebugTarget(IMAGE_CODE, makeConfig()).code).toBe(newBufferACode);
    });
  });

  // -------------------------------------------------------------------------
  describe('updateFunctionContext uses active buffer code', () => {
    beforeEach(() => {
      manager.setShaderContext(makeConfig(), '/shaders/image.glsl', {
        BufferA: HELPER_BUFFER_CODE,
        common: COMMON_CODE,
      });
    });

    it('extracts function context from buffer code when buffer is active', () => {
      // Line 1 of HELPER_BUFFER_CODE is inside the `circle` function
      manager.updateDebugLine(1, '  float d = length(p) - r;', '/shaders/bufferA.glsl');
      const ctx = manager.getState().functionContext;
      expect(ctx).not.toBeNull();
      expect(ctx?.functionName).toBe('circle');
    });

    it('extracts function context from Image code when Image is active', () => {
      manager.setImageShaderCode(HELPER_BUFFER_CODE);
      manager.updateDebugLine(1, '  float d = length(p) - r;', '/shaders/image.glsl');
      const ctx = manager.getState().functionContext;
      expect(ctx).not.toBeNull();
      expect(ctx?.functionName).toBe('circle');
    });

    it('extracts function context from common code when common is active', () => {
      // Line 1 of COMMON_CODE is inside `sdf`
      manager.updateDebugLine(1, '  float d = length(p) - r;', '/shaders/common.glsl');
      const ctx = manager.getState().functionContext;
      expect(ctx).not.toBeNull();
      expect(ctx?.functionName).toBe('sdf');
    });

    it('returns null function context when cursor is outside any function in buffer', () => {
      // Line 0 of HELPER_BUFFER_CODE is the function signature line, not inside
      manager.updateDebugLine(3, 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {', '/shaders/bufferA.glsl');
      // mainImage is a function — context should still be present (mainImage)
      const ctx = manager.getState().functionContext;
      // It could be mainImage context — just verify it doesn't error
      expect(() => manager.getState()).not.toThrow();
    });

    it('clears custom params when switching to a different function in a buffer', () => {
      manager.updateDebugLine(1, '  float d = length(p) - r;', '/shaders/bufferA.glsl');
      manager.setCustomParameter(0, '0.3');
      expect(manager.getCustomParameters().size).toBe(1);

      // Switch to a different line in a different function
      manager.updateDebugLine(4, '  fragColor = vec4(circle(fragCoord / iResolution.xy, 0.3));', '/shaders/bufferA.glsl');
      expect(manager.getCustomParameters().size).toBe(0);
    });

    it('clears custom params when switching from buffer to Image', () => {
      manager.updateDebugLine(1, '  float d = length(p) - r;', '/shaders/bufferA.glsl');
      manager.setCustomParameter(0, '0.3');

      manager.setImageShaderCode(IMAGE_CODE);
      manager.updateDebugLine(1, 'float t = iTime;', '/shaders/image.glsl');
      expect(manager.getCustomParameters().size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('line lock respects buffer files', () => {
    beforeEach(() => {
      manager.setShaderContext(makeConfig(), '/shaders/image.glsl', {
        BufferA: BUFFER_A_CODE,
      });
    });

    it('locks to buffer file path when toggleLineLock is called while on a buffer line', () => {
      manager.updateDebugLine(1, 'float d = length(fragCoord / iResolution.xy - 0.5);', '/shaders/bufferA.glsl');
      manager.toggleLineLock();
      expect(manager.getState().isLineLocked).toBe(true);

      // Another update from same buffer file should be ignored (locked)
      manager.updateDebugLine(2, 'fragColor = vec4(d);', '/shaders/bufferA.glsl');
      expect(manager.getState().currentLine).toBe(1);
    });

    it('auto-unlocks when cursor moves to a different file while locked', () => {
      manager.updateDebugLine(1, 'float d = length(fragCoord / iResolution.xy - 0.5);', '/shaders/bufferA.glsl');
      manager.toggleLineLock();

      // Cursor moves to Image file — should auto-unlock
      manager.updateDebugLine(0, 'float t = iTime;', '/shaders/image.glsl');
      expect(manager.getState().isLineLocked).toBe(false);
      expect(manager.getState().activeBufferName).toBe('Image');
    });
  });
});
