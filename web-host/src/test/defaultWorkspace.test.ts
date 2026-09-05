import { describe, expect, it } from 'vitest';
import { createDefaultWorkspaceFiles } from '../defaultWorkspace';

describe('default workspace', () => {
  it('preserves the display aspect ratio in the cubemap camera direction', () => {
    const cubemapShader = createDefaultWorkspaceFiles().find(
      ({ path }) => path === '/shaders/desert-cubemap.glsl',
    );

    expect(cubemapShader?.contents).toContain(
      'vec2 p = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;',
    );
  });
});
