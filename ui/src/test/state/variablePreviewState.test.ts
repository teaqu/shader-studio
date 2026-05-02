import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearVariablePreview,
  getVariablePreview,
  resetVariablePreview,
  setVariablePreview,
} from '../../lib/state/variablePreviewState.svelte';

describe('variablePreviewState', () => {
  beforeEach(() => {
    resetVariablePreview();
  });

  it('stores the active variable preview identity', () => {
    setVariablePreview({
      varName: 'surfaceNormal',
      varType: 'vec3',
      debugLine: 12,
      activeBufferName: 'BufferA',
      filePath: '/shaders/buffer-a.glsl',
    });

    expect(getVariablePreview()).toEqual({
      varName: 'surfaceNormal',
      varType: 'vec3',
      debugLine: 12,
      activeBufferName: 'BufferA',
      filePath: '/shaders/buffer-a.glsl',
      token: 1,
    });
  });

  it('clears the active variable preview identity', () => {
    setVariablePreview({
      varName: 'surfaceNormal',
      varType: 'vec3',
      debugLine: 12,
      activeBufferName: 'BufferA',
      filePath: '/shaders/buffer-a.glsl',
    });

    clearVariablePreview();

    expect(getVariablePreview()).toEqual({
      varName: null,
      varType: null,
      debugLine: null,
      activeBufferName: null,
      filePath: null,
      token: 2,
    });
  });

  it('keeps a newer active preview when clearing a different variable identity', () => {
    setVariablePreview({
      varName: 'surfaceNormal',
      varType: 'vec3',
      debugLine: 12,
      activeBufferName: 'BufferA',
      filePath: '/shaders/buffer-a.glsl',
    });
    setVariablePreview({
      varName: 'albedo',
      varType: 'vec4',
      debugLine: 18,
      activeBufferName: 'Image',
      filePath: '/shaders/image.glsl',
    });

    clearVariablePreview('surfaceNormal', 'vec3');

    expect(getVariablePreview()).toEqual({
      varName: 'albedo',
      varType: 'vec4',
      debugLine: 18,
      activeBufferName: 'Image',
      filePath: '/shaders/image.glsl',
      token: 2,
    });
  });
});
