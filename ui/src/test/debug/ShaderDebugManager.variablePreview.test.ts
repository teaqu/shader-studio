import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';
import type { CapturedVariable } from '../../lib/VariableCaptureManager';

const IMAGE_CODE = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float myVar = uv.x;
  float other = myVar * 2.0;
  fragColor = vec4(other);
}`;

const CAPTURED_VAR: CapturedVariable = {
  varName: 'myVar',
  varType: 'float',
  declarationLine: 2,
  captureLine: 3,
  captureFilePath: '/shaders/image.glsl',
  captureBufferName: 'Image',
  value: null,
  channelMeans: [0.5],
  channelStats: [{ min: 0, max: 1, mean: 0.5 }],
  stats: { min: 0, max: 1, mean: 0.5 },
  histogram: null,
  channelHistograms: null,
  colorFrequencies: null,
  thumbnail: new Uint8ClampedArray(4),
  gridWidth: 1,
  gridHeight: 1,
};

describe('ShaderDebugManager — variable preview', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled();
    manager.setImageShaderCode(IMAGE_CODE);
  });

  function startPreview(varName: string, varType: string, debugLine = 3, activeBufferName = 'Image') {
    return manager.setVariablePreview({
      varName,
      varType,
      debugLine,
      activeBufferName,
      filePath: '/shaders/image.glsl',
    });
  }

  it('previews the hovered variable at the selected debug line without moving to its declaration line', () => {
    manager.updateDebugLine(3, '  float other = myVar * 2.0;', '/shaders/image.glsl');

    expect(startPreview('myVar', 'float')).toBe(true);

    const state = manager.getState();
    expect(state.currentLine).toBe(3);
    expect(state.lineContent).toBe('  float other = myVar * 2.0;');

    const modifiedCode = manager.modifyShaderForDebugging(IMAGE_CODE, state.currentLine!);

    expect(modifiedCode).toContain('float other = myVar * 2.0;');
    expect(modifiedCode).toContain('fragColor = vec4(vec3(myVar), 1.0);');
    expect(modifiedCode).not.toContain('fragColor = vec4(vec3(other), 1.0);');
  });

  it('restores normal line debugging when the variable preview is cleared', () => {
    manager.updateDebugLine(3, '  float other = myVar * 2.0;', '/shaders/image.glsl');

    expect(startPreview('myVar', 'float')).toBe(true);
    expect(manager.clearVariablePreview()).toBe(true);

    const state = manager.getState();
    const modifiedCode = manager.modifyShaderForDebugging(IMAGE_CODE, state.currentLine!);

    expect(modifiedCode).toContain('fragColor = vec4(vec3(other), 1.0);');
    expect(modifiedCode).not.toContain('fragColor = vec4(vec3(myVar), 1.0);');
  });

  it('does not start a preview while line lock is enabled', () => {
    manager.updateDebugLine(3, '  float other = myVar * 2.0;', '/shaders/image.glsl');
    manager.toggleLineLock();

    expect(startPreview('myVar', 'float')).toBe(false);

    const state = manager.getState();
    expect(state.isLineLocked).toBe(true);
    expect(state.currentLine).toBe(3);

    const modifiedCode = manager.modifyShaderForDebugging(IMAGE_CODE, state.currentLine!);
    expect(modifiedCode).toContain('fragColor = vec4(vec3(other), 1.0);');
  });

  it('previews the hovered variable while inline line rendering is disabled', () => {
    manager.updateDebugLine(3, '  float other = myVar * 2.0;', '/shaders/image.glsl');
    manager.setInlineRenderingEnabled(false);

    expect(startPreview('myVar', 'float')).toBe(true);

    const state = manager.getState();
    const modifiedCode = manager.modifyShaderForDebugging(IMAGE_CODE, state.currentLine!);

    expect(modifiedCode).toContain('fragColor = vec4(vec3(myVar), 1.0);');
    expect(modifiedCode).not.toContain('fragColor = vec4(vec3(other), 1.0);');
  });

  it('does not notify variable capture when preview starts or clears', () => {
    const onCaptureStateChanged = vi.fn();
    manager.updateDebugLine(3, '  float other = myVar * 2.0;', '/shaders/image.glsl');
    manager.setCaptureStateCallback(onCaptureStateChanged);

    expect(startPreview('myVar', 'float')).toBe(true);
    expect(manager.clearVariablePreview()).toBe(true);

    expect(onCaptureStateChanged).not.toHaveBeenCalled();
  });

  it('uses the capture line from the mini preview instead of the current selected line', () => {
    manager.updateDebugLine(4, '  fragColor = vec4(other);', '/shaders/image.glsl');

    expect(startPreview('myVar', 'float', 3)).toBe(true);

    const state = manager.getState();
    expect(state.currentLine).toBe(4);

    const modifiedCode = manager.modifyShaderForDebugging(IMAGE_CODE, state.currentLine!);

    expect(modifiedCode).toContain('float other = myVar * 2.0;');
    expect(modifiedCode).toContain('fragColor = vec4(vec3(myVar), 1.0);');
    expect(modifiedCode).not.toContain('fragColor = vec4(vec3(other), 1.0);');
  });

  it('keeps captured variables when clearing a preview while inline rendering is disabled', () => {
    manager.setVariableInspectorEnabled(true);
    manager.updateDebugLine(3, '  float other = myVar * 2.0;', '/shaders/image.glsl');
    manager.setInlineRenderingEnabled(false);
    manager.setCapturedVariables([CAPTURED_VAR]);

    expect(startPreview('myVar', 'float')).toBe(true);
    expect(manager.clearVariablePreview()).toBe(true);

    const state = manager.getState();
    const modifiedCode = manager.modifyShaderForDebugging(IMAGE_CODE, state.currentLine!);

    expect(modifiedCode).toBeNull();
    expect(manager.getState().debugNotice).toBeNull();
    expect(manager.getState().capturedVariables).toHaveLength(1);
    expect(manager.getState().capturedVariables[0].varName).toBe('myVar');
  });
});
