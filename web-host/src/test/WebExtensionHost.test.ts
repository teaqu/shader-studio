import { describe, expect, it, vi } from 'vitest';
import { WebExtensionHost } from '../WebExtensionHost';
import { MemoryWorkspaceStore, VirtualWorkspace } from '../VirtualWorkspace';

async function createHost(options: ConstructorParameters<typeof WebExtensionHost>[1] = {}) {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), [
    {
      path: '/shaders/aurora.glsl',
      contents: 'void mainImage(out vec4 color, vec2 coord) { color = vec4(1.0); }',
      createdAt: 10,
      modifiedAt: 10,
    },
    {
      path: '/shaders/aurora.sha.json',
      contents: JSON.stringify({
        version: '1.0',
        passes: { Image: { inputs: { iChannel0: { type: 'texture', path: 'shader-studio://textures/nebula' } } } },
      }),
      createdAt: 10,
      modifiedAt: 10,
    },
    {
      path: '/shaders/clouds.slang',
      contents: 'float4 mainImage(float2 coord) { return 1; }',
      createdAt: 20,
      modifiedAt: 20,
    },
  ]);
  return new WebExtensionHost(workspace, {
    resolveDefaultAsset: (path) => path === 'shader-studio://textures/nebula' ? '/default-assets/nebula.png' : null,
    ...options,
  });
}

describe('WebExtensionHost', () => {
  it('upgrades the legacy web starter shader that failed thumbnail compilation', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), [{
      path: '/shaders/legacy.glsl',
      contents: 'void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0, 0, 0, 1); }\n',
      createdAt: 1,
      modifiedAt: 1,
    }]);

    new WebExtensionHost(workspace);

    expect(workspace.readText('/shaders/legacy.glsl')).toContain(
      'vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0, 2, 4));',
    );
  });

  it('serves the virtual workspace through the shader explorer protocol', async () => {
    const host = await createHost();
    const receive = vi.fn();
    host.onExplorerMessage(receive);

    await host.handleExplorerMessage({ type: 'requestShaders' });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shadersUpdate',
      shaders: [
        expect.objectContaining({ path: '/shaders/aurora.glsl', hasConfig: true }),
        expect.objectContaining({ path: '/shaders/clouds.slang', hasConfig: false }),
      ],
    }));
  });

  it('returns shader code and resolves built-in asset URLs', async () => {
    const host = await createHost();
    const receive = vi.fn();
    host.onExplorerMessage(receive);

    await host.handleExplorerMessage({ type: 'requestShaderCode', path: '/shaders/aurora.glsl', requestId: 7 });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderCode',
      requestId: 7,
      path: '/shaders/aurora.glsl',
      language: 'glsl',
      config: expect.objectContaining({
        passes: { Image: { inputs: { iChannel0: expect.objectContaining({ resolved_path: '/default-assets/nebula.png' }) } } },
      }),
    }));
  });

  it('activates explorer files on the viewer channel', async () => {
    const host = await createHost();
    const receive = vi.fn();
    host.onViewerMessage(receive);

    await host.handleExplorerMessage({ type: 'activateShader', path: '/shaders/clouds.slang' });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderSource',
      path: '/shaders/clouds.slang',
      language: 'slang',
    }));
  });

  it('writes viewer edits back to the same filesystem used by the explorer', async () => {
    const host = await createHost();
    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: { path: '/shaders/aurora.glsl', code: 'edited source' },
    });
    const receive = vi.fn();
    host.onExplorerMessage(receive);

    await host.handleExplorerMessage({ type: 'requestShaderCode', path: '/shaders/aurora.glsl', requestId: 8 });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ code: 'edited source', requestId: 8 }));
  });

  it('reports malformed configs without losing the shader source', async () => {
    const host = await createHost();
    await host.handleViewerMessage({
      type: 'updateConfig',
      payload: { path: '/shaders/aurora.glsl', text: '{bad json' },
    });
    const receive = vi.fn();
    host.onExplorerMessage(receive);

    await host.handleExplorerMessage({ type: 'requestShaderCode', path: '/shaders/aurora.glsl', requestId: 9 });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      code: expect.stringContaining('mainImage'),
      config: null,
      configError: expect.stringContaining('Failed to parse config'),
    }));
  });

  it('creates and renames shader files through explorer commands', async () => {
    const prompt = vi.fn()
      .mockReturnValueOnce('renamed.glsl');
    const host = await createHost({ prompt });
    const receive = vi.fn();
    host.onExplorerMessage(receive);

    await host.handleViewerMessage({ type: 'createShader', payload: { name: 'new', language: 'glsl' } });
    await host.handleExplorerMessage({ type: 'renameShader', path: '/shaders/new.glsl' });
    await host.handleExplorerMessage({ type: 'requestShaderCode', path: '/shaders/renamed.glsl', requestId: 10 });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderCode',
      path: '/shaders/renamed.glsl',
      requestId: 10,
      code: expect.stringContaining('vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0, 2, 4));'),
    }));
  });

  it('creates the animated Slang starter template', async () => {
    const host = await createHost();
    const receive = vi.fn();
    host.onExplorerMessage(receive);

    await host.handleViewerMessage({ type: 'createShader', payload: { name: 'new', language: 'slang' } });
    await host.handleExplorerMessage({ type: 'requestShaderCode', path: '/shaders/new.slang', requestId: 12 });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderCode',
      path: '/shaders/new.slang',
      requestId: 12,
      code: expect.stringContaining('float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));'),
    }));
  });

  it('routes every new shader request to the viewer modal and creates the selected language', async () => {
    const host = await createHost();
    const viewerReceive = vi.fn();
    host.onViewerMessage(viewerReceive);

    await host.handleViewerMessage({ type: 'extensionCommand', payload: { command: 'newShader' } });
    await host.handleExplorerMessage({ type: 'newShader' });

    expect(viewerReceive).toHaveBeenCalledTimes(2);
    expect(viewerReceive).toHaveBeenCalledWith({ type: 'showNewShaderModal' });

    await host.handleViewerMessage({
      type: 'createShader',
      payload: { name: 'plasma', language: 'slang' },
    });
    const explorerReceive = vi.fn();
    host.onExplorerMessage(explorerReceive);
    await host.handleExplorerMessage({ type: 'requestShaderCode', path: '/shaders/plasma.slang', requestId: 13 });

    expect(explorerReceive).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderCode',
      path: '/shaders/plasma.slang',
      code: expect.stringContaining('float3 col'),
    }));
  });

  it('honours delete cancellation before changing the filesystem', async () => {
    const host = await createHost({ confirm: () => false });
    const receive = vi.fn();
    host.onExplorerMessage(receive);

    await host.handleExplorerMessage({ type: 'deleteShader', path: '/shaders/aurora.glsl' });
    await host.handleExplorerMessage({ type: 'requestShaderCode', path: '/shaders/aurora.glsl', requestId: 11 });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderCode',
      path: '/shaders/aurora.glsl',
      requestId: 11,
    }));
  });

  it('clears the active-file marker when the final shader is deleted', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), [
      { path: '/shaders/only.glsl', contents: 'void mainImage() {}', createdAt: 1, modifiedAt: 1 },
    ]);
    const host = new WebExtensionHost(workspace, { confirm: () => true });

    await host.handleExplorerMessage({ type: 'activateShader', path: '/shaders/only.glsl' });
    await host.handleExplorerMessage({ type: 'deleteShader', path: '/shaders/only.glsl' });

    expect(workspace.exists('/.shader-studio/active-shader')).toBe(false);
  });

  it('persists explorer settings and valid thumbnails in the virtual filesystem', async () => {
    const host = await createHost();
    await host.handleExplorerMessage({ type: 'saveState', state: { layoutMode: 'row' } });
    await host.handleExplorerMessage({
      type: 'saveThumbnail',
      path: '/shaders/aurora.glsl',
      thumbnail: 'data:image/png;base64,cached',
      modifiedTime: 10,
    });
    const receive = vi.fn();
    host.onExplorerMessage(receive);

    await host.handleExplorerMessage({ type: 'requestShaders' });

    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      savedState: { layoutMode: 'row' },
      shaders: expect.arrayContaining([
        expect.objectContaining({
          path: '/shaders/aurora.glsl',
          cachedThumbnail: 'data:image/png;base64,cached',
        }),
      ]),
    }));
  });

  it('invalidates cached thumbnails after the shader changes', async () => {
    const host = await createHost();
    await host.handleExplorerMessage({
      type: 'saveThumbnail',
      path: '/shaders/aurora.glsl',
      thumbnail: 'data:image/png;base64,stale',
      modifiedTime: 10,
    });
    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: { path: '/shaders/aurora.glsl', code: 'changed' },
    });
    const receive = vi.fn();
    host.onExplorerMessage(receive);

    await host.handleExplorerMessage({ type: 'requestShaders' });

    const update = receive.mock.calls.at(-1)?.[0];
    expect(update.shaders.find((shader: { path: string }) => shader.path === '/shaders/aurora.glsl'))
      .not.toHaveProperty('cachedThumbnail', 'data:image/png;base64,stale');
  });
});
