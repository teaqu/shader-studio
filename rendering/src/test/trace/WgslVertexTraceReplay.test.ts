import { describe, expect, it } from 'vitest';
import { vertexReplayEntry } from '../../trace/WgslVertexTraceReplay';

describe('WGSL vertex replay entry', () => {
  it('extracts the clip position from the fullscreen vertex result', () => {
    const source = vertexReplayEntry(true, 7);
    expect(source).toContain('_ss_trace_vertexResult[0] = vertexMain(u32(7)).position;');
  });

  it('forwards the selected vertex and first instance to the generated mesh hook', () => {
    const source = vertexReplayEntry(false, 7);
    expect(source).toContain('vertexMain(p,n,uv,u32(7),0u).position;');
    expect(source).toContain('_ss_trace_vertexData[7]');
  });
});
