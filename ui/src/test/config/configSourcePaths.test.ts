import { expect, it } from 'vitest';
import { configSourcePaths } from '../../lib/config/configSourcePaths';
it('includes root, common, render, compute and vertex files once and filters other languages', () => {
  expect(configSourcePaths({ version:'1.0', passes: { Image:{vertex:'mesh.wgsl'}, common:{path:'shared.wgsl'}, BufferA:{path:'a.wgsl'}, BufferB:{path:'a.wgsl'}, Other:{path:'other.slang'}, ComputeA:{type:'compute',path:'compute.wgsl'} } }, 'image.wgsl','wgsl')).toEqual(['image.wgsl','mesh.wgsl','shared.wgsl','a.wgsl','compute.wgsl']);
  expect(configSourcePaths(null,'','glsl')).toEqual([]);
});
