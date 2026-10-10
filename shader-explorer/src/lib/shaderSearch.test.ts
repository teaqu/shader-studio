import { describe, expect, it } from 'vitest';
import { getVisibleShadersForSearch } from './shaderSearch';

const shaders = [
  { name: 'image.glsl', path: '/buffers/image.glsl' },
  { name: 'trails.buffer.glsl', path: '/trails.buffer.glsl' },
  { name: 'BufferA.slang', path: '/BufferA.slang' },
].map(shader => ({ ...shader, relativePath: shader.path, hasConfig: false }));
const params = {
  shaders,
  search: '',
  searchResultPaths: null,
  hideFailedShaders: false,
  failedShaderPaths: new Set<string>(),
  sortBy: 'name' as const,
  sortOrder: 'desc' as const,
};

describe('buffer shader visibility', () => {
  it('hides buffer names case-insensitively by default, but not buffer directories', () => {
    expect(getVisibleShadersForSearch(params)).toEqual([shaders[0]]);
  });

  it('can show buffers while still excluding failed shaders', () => {
    expect(getVisibleShadersForSearch({ ...params, hideBufferShaders: false })).toHaveLength(3);
    expect(getVisibleShadersForSearch({
      ...params, hideBufferShaders: false, hideFailedShaders: true,
      failedShaderPaths: new Set(shaders.slice(1).map(shader => shader.path)),
    })).toEqual([shaders[0]]);
  });

  it.each([null, shaders.map(shader => shader.path)])('filters pending and completed search results (%j)', paths => {
    expect(getVisibleShadersForSearch({ ...params, search: 'shader', searchResultPaths: paths }))
      .toEqual([shaders[0]]);
  });

  it('preserves relevance order when buffers are shown', () => {
    expect(getVisibleShadersForSearch({
      ...params, hideBufferShaders: false, search: 'shader',
      searchResultPaths: shaders.map(shader => shader.path).reverse(),
    })).toEqual([...shaders].reverse());
  });
});


describe('vertex shader visibility', () => {
  const vertexShaders = [
    { name: 'image.glsl', path: '/mesh.vert/image.glsl' },
    { name: 'mesh.vert.glsl', path: '/mesh.vert.glsl' },
    { name: 'MESH.VERT.wgsl', path: '/MESH.VERT.wgsl' },
    { name: 'vertex.glsl', path: '/vertex.glsl' },
  ].map(shader => ({ ...shader, relativePath: shader.path, hasConfig: false }));
  const vertexParams = { ...params, shaders: vertexShaders };

  it('hides .vert filenames by default regardless of case, without hiding directories or vertex words', () => {
    expect(getVisibleShadersForSearch(vertexParams)).toEqual([vertexShaders[0], vertexShaders[3]]);
  });

  it.each([null, vertexShaders.map(shader => shader.path)])('filters pending and completed search results (%j)', paths => {
    expect(getVisibleShadersForSearch({ ...vertexParams, search: 'shader', searchResultPaths: paths }))
      .toEqual([vertexShaders[0], vertexShaders[3]]);
  });

  it('can reveal vertex names while preserving search relevance and failed-shader filtering', () => {
    const searchPaths = vertexShaders.map(shader => shader.path).reverse();
    expect(getVisibleShadersForSearch({
      ...vertexParams, hideVertexShaders: false, search: 'shader', searchResultPaths: searchPaths,
    })).toEqual([...vertexShaders].reverse());
    expect(getVisibleShadersForSearch({
      ...vertexParams, hideVertexShaders: false, hideFailedShaders: true,
      failedShaderPaths: new Set(vertexShaders.slice(1).map(shader => shader.path)),
    })).toEqual([vertexShaders[0]]);
  });
});
