import { expect, it } from 'vitest';
import { applyRenderSource, applyVertexSource, bufferInsertionTarget } from '../../lib/config/PassSourceAuthoring';
it('keeps vertex authoring changes within the owning pass and preserves its fragment', () => {
  const pass = { path: 'buffer.wgsl', entryPoints: { vertex: 'before', fragment: 'paint' } };
  const native = applyVertexSource(pass, { path: 'buffer.wgsl', authoringMode: 'native', entryPoints: { vertex: 'after' } });
  expect(native).toMatchObject({ path: 'buffer.wgsl', entryPoints: { vertex: 'after', fragment: 'paint' } });
  expect(applyVertexSource(native, { path: 'buffer.wgsl', authoringMode: 'hooks' }).entryPoints).toEqual({ fragment: 'paint' });
  expect(pass.entryPoints.vertex).toBe('before');
});
it('switches the main source to built-in without stale native entries or MRT outputs', () => {
  const pass = { path: 'before', entryPoints: { fragment: 'paint' }, outputs: [{}, {}] };
  expect(applyRenderSource(pass, { path: 'after', authoringMode: 'hooks' })).toEqual({ path: 'after' });
  expect(applyRenderSource(pass, { path: 'after', authoringMode: 'native', entryPoints: { fragment: 'new' } })).toMatchObject({ entryPoints: { fragment: 'new' }, outputs: [{}, {}] });
});
it('resolves an owned buffer path and a default destination for a new buffer', () => {
  expect(bufferInsertionTarget({ path: 'a.wgsl' }, '/image.wgsl', 'suggested.wgsl')).toBe('a.wgsl');
  expect(bufferInsertionTarget({ path: '' }, '/image.wgsl', 'suggested.wgsl')).toBe('suggested.wgsl');
});
