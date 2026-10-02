import { beforeEach, describe, expect, it } from 'vitest';
import {
  rememberDrawFields,
  resetVerticesDrawMemory,
  takeDrawField,
} from '../../lib/state/verticesDrawMemory.svelte';

describe('verticesDrawMemory', () => {
  beforeEach(() => {
    resetVerticesDrawMemory();
  });

  it('returns nothing for a pass with no remembered fields', () => {
    expect(takeDrawField('/s.glsl', 'Image', 'vertices')).toBeUndefined();
    expect(takeDrawField('/s.glsl', 'Image', 'depth')).toBeUndefined();
    expect(takeDrawField('/s.glsl', 'Image', 'cull')).toBeUndefined();
  });

  it('returns remembered vertices fields once, then forgets them', () => {
    rememberDrawFields('/s.glsl', 'Image', { vertices: { vertexCount: 6, topology: 'line-strip', space: 'clip' } });

    expect(takeDrawField('/s.glsl', 'Image', 'vertices')).toEqual({ vertexCount: 6, topology: 'line-strip', space: 'clip' });
    expect(takeDrawField('/s.glsl', 'Image', 'vertices')).toBeUndefined();
  });

  it('keeps each field group separately and forgets only the one taken', () => {
    rememberDrawFields('/s.glsl', 'BufferA', { vertices: { vertexCount: 6 } });
    rememberDrawFields('/s.glsl', 'BufferA', { depth: { write: false }, cull: 'back' });

    expect(takeDrawField('/s.glsl', 'BufferA', 'cull')).toBe('back');
    expect(takeDrawField('/s.glsl', 'BufferA', 'vertices')).toEqual({ vertexCount: 6 });
    expect(takeDrawField('/s.glsl', 'BufferA', 'depth')).toEqual({ write: false });
    expect(takeDrawField('/s.glsl', 'BufferA', 'depth')).toBeUndefined();
  });

  it('drops undefined fields and ignores empty groups without erasing earlier memory', () => {
    rememberDrawFields('/s.glsl', 'Image', { vertices: { vertexCount: 6, topology: undefined } });
    rememberDrawFields('/s.glsl', 'Image', { vertices: { vertexCount: undefined }, depth: {}, cull: undefined });

    expect(takeDrawField('/s.glsl', 'Image', 'vertices')).toEqual({ vertexCount: 6 });
    expect(takeDrawField('/s.glsl', 'Image', 'depth')).toBeUndefined();
  });

  it('replaces a group remembered again', () => {
    rememberDrawFields('/s.glsl', 'Image', { vertices: { vertexCount: 6, space: 'clip' } });
    rememberDrawFields('/s.glsl', 'Image', { vertices: { topology: 'point-list' } });

    expect(takeDrawField('/s.glsl', 'Image', 'vertices')).toEqual({ topology: 'point-list' });
  });

  it('keys memory by shader path and pass name, including an absent shader path', () => {
    rememberDrawFields('/a.glsl', 'Image', { cull: 'front' });
    rememberDrawFields(undefined, 'Image', { cull: 'back' });

    expect(takeDrawField('/b.glsl', 'Image', 'cull')).toBeUndefined();
    expect(takeDrawField('/a.glsl', 'BufferA', 'cull')).toBeUndefined();
    expect(takeDrawField('/a.glsl', 'Image', 'cull')).toBe('front');
    expect(takeDrawField(undefined, 'Image', 'cull')).toBe('back');
  });

  it('remembers an instance count separately from the vertices fields', () => {
    rememberDrawFields('/s.glsl', 'Image', { vertices: { vertexCount: 6 }, instanceCount: 12 });
    rememberDrawFields('/s.glsl', 'Image', { instanceCount: undefined });

    expect(takeDrawField('/s.glsl', 'Image', 'instanceCount')).toBe(12);
    expect(takeDrawField('/s.glsl', 'Image', 'instanceCount')).toBeUndefined();
    expect(takeDrawField('/s.glsl', 'Image', 'vertices')).toEqual({ vertexCount: 6 });
  });

  it('forgets everything on reset', () => {
    rememberDrawFields('/s.glsl', 'Image', { vertices: { vertexCount: 6 }, cull: 'back' });

    resetVerticesDrawMemory();

    expect(takeDrawField('/s.glsl', 'Image', 'vertices')).toBeUndefined();
    expect(takeDrawField('/s.glsl', 'Image', 'cull')).toBeUndefined();
  });
});
