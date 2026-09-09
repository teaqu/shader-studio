import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultWorkspaceFiles } from '../defaultWorkspace';
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
  it.each(['glsl', 'frag', 'slang', 'SLANG'])('forks %s source and config and restores the fork after reload', async (extension) => {
    const store = new MemoryWorkspaceStore();
    const sourcePath = `/shaders/nested/example.${extension}`;
    const destination = `/shaders/nested/example.1.${extension}`;
    const workspace = await VirtualWorkspace.open(store, []);
    workspace.writeText(sourcePath, 'original source');
    const config = '{"version":"1.0","passes":{"Image":{"inputs":{}}}}';
    workspace.writeText('/shaders/nested/example.sha.json', config);
    const host = new WebExtensionHost(workspace);
    const viewer = vi.fn();
    const explorer = vi.fn();
    host.onViewerMessage(viewer);
    host.onExplorerMessage(explorer);

    await host.handleViewerMessage({ type: 'forkShader', payload: { shaderPath: sourcePath } });

    expect(workspace.readText(destination)).toBe('original source');
    expect(workspace.readText('/shaders/nested/example.1.sha.json')).toBe(config);
    expect(workspace.readText(sourcePath)).toBe('original source');
    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({ type: 'shaderSource', path: destination }));
    expect(explorer).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shadersUpdate', shaders: expect.arrayContaining([expect.objectContaining({ path: destination })]),
    }));
    workspace.writeText(destination, 'fork edit');
    expect(workspace.readText(sourcePath)).toBe('original source');
    await host.flush();
    const restored = new WebExtensionHost(await VirtualWorkspace.open(store, []));
    const restoredViewer = vi.fn();
    restored.onViewerMessage(restoredViewer);
    await restored.start();
    expect(restoredViewer).toHaveBeenCalledWith(expect.objectContaining({ path: destination, code: 'fork edit' }));
  });

  it('forks a numbered shader without config and skips occupied shader and config names', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
    workspace.writeText('/shaders/example.1.glsl', 'source');
    workspace.writeText('/shaders/example.2.sha.json', 'existing config');
    const host = new WebExtensionHost(workspace);
    await host.handleViewerMessage({ type: 'forkShader', payload: { shaderPath: '/shaders/example.1.glsl' } });
    expect(workspace.readText('/shaders/example.3.glsl')).toBe('source');
    expect(workspace.exists('/shaders/example.3.sha.json')).toBe(false);
    expect(workspace.readText('/shaders/example.2.sha.json')).toBe('existing config');
  });

  it('preserves malformed config text when forking', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
    workspace.writeText('/shader.glsl', 'source');
    workspace.writeText('/shader.sha.json', '{bad json');
    const host = new WebExtensionHost(workspace);
    await host.handleViewerMessage({ type: 'forkShader', payload: { shaderPath: '/shader.glsl' } });
    expect(workspace.readText('/shader.1.sha.json')).toBe('{bad json');
  });

  it.each([undefined, {}, { shaderPath: '' }, { shaderPath: 42 }, { shaderPath: '/missing.glsl' }, { shaderPath: '/shaders/aurora.sha.json' }])('ignores invalid fork payload %j', async (payload) => {
    const host = await createHost();
    const viewer = vi.fn();
    const explorer = vi.fn();
    host.onViewerMessage(viewer);
    host.onExplorerMessage(explorer);
    await host.handleViewerMessage({ type: 'forkShader', payload });
    expect(viewer).not.toHaveBeenCalled();
    expect(explorer).not.toHaveBeenCalled();
  });

  it.each([
    ['glsl-buffer', 'glsl', 'vec4'],
    ['slang-buffer', 'slang', 'float4'],
    ['glsl-common', 'glsl', '// Common'],
    ['slang-common', 'slang', '// Common'],
    ['slang-compute', 'slang', '[shader("compute")]'],
    ['glsl-vertex', 'glsl', 'void mainVertex'],
    ['slang-vertex', 'slang', 'void mainVertex'],
  ])('creates and loads %s files through the config protocol', async (fileType, extension, expected) => {
    const host = await createHost({ prompt: (_message, initial) => initial });
    const receive = vi.fn();
    host.onViewerMessage(receive);
    const path = `./passes/buffer.${extension}`;
    await host.handleViewerMessage({ type: 'createFile', payload: {
      shaderPath: '/shaders/clouds.slang', suggestedPath: path, fileType, requestId: 'buffer',
    } });
    expect(receive).toHaveBeenCalledWith({ type: 'fileSelected', payload: { path, requestId: 'buffer' } });
    await host.handleViewerMessage({ type: 'updateConfig', payload: {
      shaderPath: '/shaders/clouds.slang', text: JSON.stringify({ version: '1.0', passes: {
        Image: {}, BufferA: { path }, common: { path },
      } }),
    } });
    expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({
      path: '/shaders/clouds.slang', buffers: { BufferA: expect.stringContaining(expected), common: expect.stringContaining(expected) },
    }));
    const explorer = vi.fn();
    host.onExplorerMessage(explorer);
    await host.handleExplorerMessage({ type: 'requestShaderCode', path: '/shaders/clouds.slang' });
    expect(explorer).toHaveBeenLastCalledWith(expect.objectContaining({ buffers: {
      BufferA: expect.stringContaining(expected), common: expect.stringContaining(expected),
    } }));
  });

  it('opens, edits and restores buffer sources without changing the active shader', async () => {
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, [
      { path: '/main.glsl', contents: 'image', createdAt: 1, modifiedAt: 1 },
      { path: '/buffer.glsl', contents: 'original buffer', createdAt: 1, modifiedAt: 1 },
      { path: '/main.sha.json', contents: JSON.stringify({ version: '1.0', passes: {
        Image: { vertex: './buffer.glsl' }, BufferA: { path: './buffer.glsl' }, BufferB: { path: './missing.glsl' },
      } }), createdAt: 1, modifiedAt: 1 },
    ]);
    const host = new WebExtensionHost(workspace, { prompt: (_message, initial) => initial });
    const receive = vi.fn();
    host.onViewerMessage(receive);
    await host.handleExplorerMessage({ type: 'activateShader', path: '/main.glsl' });
    await host.handleViewerMessage({ type: 'createFile', payload: {
      shaderPath: '/main.glsl', suggestedPath: './buffer.glsl', fileType: 'glsl-buffer', requestId: 'existing',
    } });
    expect(workspace.readText('/buffer.glsl')).toBe('original buffer');
    for (const bufferName of ['BufferA', '__shader_studio_vertex__:Image', 'BufferB']) {
      await host.handleViewerMessage({ type: 'requestFileContents', payload: { shaderPath: '/main.glsl', bufferName } });
      expect(receive).toHaveBeenLastCalledWith({ type: 'fileContents', payload: {
        bufferName, path: bufferName === 'BufferB' ? '/missing.glsl' : '/buffer.glsl',
        code: bufferName === 'BufferB' ? '' : 'original buffer',
      } });
    }
    await host.handleViewerMessage({ type: 'updateShaderSource', payload: { path: '/buffer.glsl', code: 'edited buffer' } });
    expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/main.glsl', buffers: {
      BufferA: 'edited buffer', '__shader_studio_vertex__:Image': 'edited buffer',
    } }));
    await host.flush();
    const restored = new WebExtensionHost(await VirtualWorkspace.open(store, []));
    restored.onViewerMessage(receive);
    await restored.start();
    expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/main.glsl', buffers: {
      BufferA: 'edited buffer', '__shader_studio_vertex__:Image': 'edited buffer',
    } }));
  });

  it.each(['../../outside.glsl', '   '])('ignores invalid requested paths: %s', async (requested) => {
    const host = await createHost({ prompt: () => requested });
    const receive = vi.fn();
    host.onViewerMessage(receive);
    await host.handleViewerMessage({ type: 'createFile', payload: {
      shaderPath: '/shaders/aurora.glsl', suggestedPath: 'buffer.glsl', fileType: 'glsl-buffer',
    } });
    expect(receive).not.toHaveBeenCalled();
  });

  it('resolves parent paths and skips unknown buffer requests', async () => {
    const host = await createHost({ prompt: () => '../shared.glsl' });
    const receive = vi.fn();
    host.onViewerMessage(receive);
    await host.handleViewerMessage({ type: 'createFile', payload: {
      suggestedPath: 'buffer.glsl', fileType: 'glsl-buffer', requestId: 'parent',
    } });
    await host.handleViewerMessage({ type: 'updateConfig', payload: { text: JSON.stringify({
      version: '1.0', passes: { Image: {}, BufferA: { path: '../shared.glsl' }, BufferB: { path: '' }, common: null },
    }) } });
    await host.handleViewerMessage({ type: 'requestFileContents', payload: { bufferName: 'BufferA' } });
    expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'fileContents', payload: {
      bufferName: 'BufferA', path: '/shared.glsl', code: expect.stringContaining('mainImage'),
    } }));
    receive.mockClear();
    await host.handleViewerMessage({ type: 'requestFileContents', payload: { bufferName: 'unknown' } });
    await host.handleViewerMessage({ type: 'requestFileContents', payload: {} });
    await host.handleViewerMessage({ type: 'createFile', payload: { suggestedPath: 'file', fileType: 'unsupported' } });
    expect(receive).not.toHaveBeenCalled();
  });

  it('leaves cancelled and invalid file creation requests unchanged', async () => {
    const host = await createHost({ prompt: () => null });
    const receive = vi.fn();
    host.onViewerMessage(receive);
    await host.handleViewerMessage({ type: 'createFile', payload: {
      shaderPath: '/shaders/aurora.glsl', suggestedPath: 'buffer.glsl', fileType: 'glsl-buffer', requestId: 'cancel',
    } });
    await host.handleViewerMessage({ type: 'createFile', payload: {} });
    expect(receive).not.toHaveBeenCalled();
  });

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

  it('refreshes the requested shader instead of the active source file', async () => {
    const host = await createHost();
    const receive = vi.fn();
    host.onViewerMessage(receive);
    await host.handleExplorerMessage({ type: 'activateShader', path: '/shaders/clouds.slang' });
    receive.mockClear();

    await host.handleViewerMessage({ type: 'refresh', payload: { path: '/shaders/aurora.glsl' } });

    expect(receive).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: 'shaderSource', path: '/shaders/aurora.glsl',
    }));
    receive.mockClear();
    await host.handleViewerMessage({ type: 'refresh' });
    expect(receive).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: 'shaderSource', path: '/shaders/aurora.glsl',
    }));
  });

  it.each([{}, { path: undefined }])('refreshes the active shader when no path is requested: %j', async (payload) => {
    const host = await createHost();
    const receive = vi.fn();
    host.onViewerMessage(receive);
    await host.handleViewerMessage({ type: 'refresh', payload });
    expect(receive).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: 'shaderSource', path: '/shaders/aurora.glsl',
    }));
  });

  it.each(['/missing.glsl', '', 42, null])('ignores an invalid refresh target: %j', async (path) => {
    const host = await createHost();
    const receive = vi.fn();
    host.onViewerMessage(receive);
    await host.handleViewerMessage({ type: 'refresh', payload: { path } });
    expect(receive).not.toHaveBeenCalled();
  });

  it.each(['common', 'vertex', 'buffer'])('keeps the owning shader active when focusing its %s file', async (source) => {
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, []);
    workspace.writeText('/main.glsl', 'main image');
    workspace.writeText('/source.glsl', 'source');
    workspace.writeText('/main.sha.json', JSON.stringify({ version: '1.0', passes: {
      Image: source === 'vertex' ? { vertex: 'source.glsl' } : {},
      ...(source === 'common' ? { common: { path: 'source.glsl' } } : {}),
      ...(source === 'buffer' ? { Buffer: { path: 'source.glsl' } } : {}),
    } }));
    const host = new WebExtensionHost(workspace);
    const receive = vi.fn();
    host.onViewerMessage(receive);
    await host.handleExplorerMessage({ type: 'openShader', path: '/main.glsl' });
    receive.mockClear();

    await host.handleExplorerMessage({ type: 'activateShader', path: '/source.glsl' });
    expect(receive).not.toHaveBeenCalled();
    await host.handleViewerMessage({ type: 'updateShaderSource', payload: { path: '/source.glsl', code: 'edited source' } });
    expect(receive).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: '/main.glsl' }));

    await host.flush();
    const restored = new WebExtensionHost(await VirtualWorkspace.open(store, []));
    const afterReload = vi.fn();
    restored.onViewerMessage(afterReload);
    await restored.start();
    expect(afterReload).toHaveBeenCalledWith(expect.objectContaining({ path: '/main.glsl' }));
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

it('saves an inactive editor without switching the preview', async () => {
  const host = await createHost();
  const receive = vi.fn();
  host.onViewerMessage(receive);
  await host.handleViewerMessage({ type: 'updateShaderSource', payload: {
    path: '/shaders/clouds.slang', code: 'edited inactive file',
  } });
  expect(host.readEditorFile('/shaders/clouds.slang')).toBe('edited inactive file');
  expect(receive).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'shaderSource', path: '/shaders/clouds.slang' }));
  await host.handleViewerMessage({ type: 'refresh' });
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ type: 'shaderSource', path: '/shaders/aurora.glsl' }));
});


it('publishes navigation paths for image, buffers, common, vertex and script files', async () => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  workspace.writeText('/shaders/main.glsl', 'image');
  workspace.writeText('/shaders/main.sha.json', JSON.stringify({ version: '1.0', script: 'script.ts', passes: {
    Image: { vertex: '../vertex.glsl' },
    Buffer: { path: 'buffer.glsl' },
    common: { path: 'common.glsl' },
  } }));
  const host = new WebExtensionHost(workspace);
  const receive = vi.fn();
  host.onViewerMessage(receive);
  await host.start();
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({
    type: 'shaderSource', bufferPathMap: expect.objectContaining({
      Image: '/shaders/main.glsl', Buffer: '/shaders/buffer.glsl', common: '/shaders/common.glsl',
      '__shader_studio_vertex__:Image': '/vertex.glsl', '../vertex.glsl': '/vertex.glsl',
      'script.ts': '/shaders/script.ts',
    }),
  }));
});


describe('standalone export downloads', () => {
  let anchor: HTMLAnchorElement;
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:export');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      anchor = this;
      expect(this.isConnected).toBe(true);
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['png', 'jpg', 'webm', 'mp4', 'gif'])('downloads %s exports and releases the URL', async (extension) => {
    const host = await createHost();
    const receive = vi.fn();
    host.onViewerMessage(receive);
    await host.handleViewerMessage({ type: 'saveFile', payload: {
      data: btoa(String.fromCharCode(0, 127, 128, 255)), defaultName: `shader.${extension}`, filters: {},
    } });
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const bytes = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(blob);
    });
    expect([...new Uint8Array(bytes)]).toEqual([0, 127, 128, 255]);
    expect(anchor.download).toBe(`shader.${extension}`);
    expect(anchor.href).toBe('blob:export');
    expect(anchor.isConnected).toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(receive).toHaveBeenCalledWith({ type: 'saveFileResult', payload: { success: true } });
    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
  });

  it.each([undefined, {}, { data: 42, defaultName: 'file.png' }, { data: '', defaultName: '' }, { data: '!!!', defaultName: 'file.png' }])('reports invalid export payload %j', async (payload) => {
    const host = await createHost();
    const receive = vi.fn();
    host.onViewerMessage(receive);
    await host.handleViewerMessage({ type: 'saveFile', payload });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(receive).toHaveBeenCalledWith({ type: 'saveFileResult', payload: { success: false, error: expect.any(String) } });
  });

  it('reports download errors and still cleans up', async () => {
    const host = await createHost();
    const receive = vi.fn();
    host.onViewerMessage(receive);
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error('Download failed');
    });
    await host.handleViewerMessage({ type: 'saveFile', payload: { data: 'AA==', defaultName: 'file.png' } });
    expect(receive).toHaveBeenCalledWith({ type: 'saveFileResult', payload: { success: false, error: expect.stringContaining('Download failed') } });
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
  });
});


describe('standalone initial shader selection', () => {
  it.each([null, '/missing.glsl', '/shaders/desert-cubemap.glsl'])(
    'prefers Aurora unless a saved shader exists (%s)', async (savedPath) => {
      const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), createDefaultWorkspaceFiles());
      if (savedPath) {
        workspace.writeText('/.shader-studio/active-shader', savedPath);
      }
      const host = new WebExtensionHost(workspace);
      const receive = vi.fn();
      host.onViewerMessage(receive);
      await host.start();
      expect(receive).toHaveBeenCalledWith(expect.objectContaining({
        type: 'shaderSource',
        path: savedPath === '/shaders/desert-cubemap.glsl' ? savedPath : '/shaders/aurora.glsl',
      }));
    },
  );

  it.each([false, true])('handles a workspace without Aurora (empty: %s)', async (empty) => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
    if (!empty) {
      workspace.writeText('/custom.glsl', 'custom source');
    }
    const host = new WebExtensionHost(workspace);
    const receive = vi.fn();
    host.onViewerMessage(receive);
    await host.start();
    if (empty) {
      expect(receive).not.toHaveBeenCalled();
    } else {
      expect(receive).toHaveBeenCalledWith(expect.objectContaining({ type: 'shaderSource', path: '/custom.glsl' }));
    }
  });
});

describe('standalone config files', () => {
  it('opens the existing config of the active shader in the editor', async () => {
    const host = await createHost();
    const viewer = vi.fn();
    host.onViewerMessage(viewer);
    await host.handleViewerMessage({
      type: 'showConfig',
      payload: { shaderPath: '/shaders/aurora.sha.json', sourcePath: '/shaders/aurora.glsl' },
    });

    expect(viewer).toHaveBeenCalledWith({ type: 'openEditorFile', payload: { path: '/shaders/aurora.sha.json' } });
    expect(viewer.mock.calls.filter(([message]) => message.type === 'shaderSource')).toHaveLength(0);
  });

  it('generates a missing config, opens it, and reloads the shader', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
    workspace.writeText('/shaders/clouds.slang', 'float4 mainImage(float2 coord) { return 1; }');
    const host = new WebExtensionHost(workspace);
    const viewer = vi.fn();
    const explorer = vi.fn();
    host.onViewerMessage(viewer);
    host.onExplorerMessage(explorer);

    await host.handleViewerMessage({
      type: 'showConfig',
      payload: { shaderPath: '/shaders/clouds.sha.json', sourcePath: '/shaders/clouds.slang' },
    });

    expect(JSON.parse(workspace.readText('/shaders/clouds.sha.json'))).toEqual({
      version: '1.0',
      passes: { Image: { inputs: {} } },
    });
    expect(viewer).toHaveBeenCalledWith({ type: 'openEditorFile', payload: { path: '/shaders/clouds.sha.json' } });
    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({ type: 'shaderSource', path: '/shaders/clouds.slang' }));
    expect(explorer).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shadersUpdate',
      shaders: [expect.objectContaining({ path: '/shaders/clouds.slang', hasConfig: true })],
    }));
  });

  it('falls back to the active shader when a config request carries no path', async () => {
    const host = await createHost();
    const viewer = vi.fn();
    host.onViewerMessage(viewer);
    await host.handleExplorerMessage({ type: 'activateShader', path: '/shaders/clouds.slang' });
    viewer.mockClear();

    await host.handleViewerMessage({ type: 'generateConfig', payload: {} });

    expect(viewer).toHaveBeenCalledWith({ type: 'openEditorFile', payload: { path: '/shaders/clouds.sha.json' } });
  });

  it('ignores config requests for shaders that are not in the workspace', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
    const host = new WebExtensionHost(workspace);
    const viewer = vi.fn();
    host.onViewerMessage(viewer);

    await host.handleViewerMessage({ type: 'showConfig', payload: { sourcePath: '/shaders/missing.glsl' } });
    await host.handleViewerMessage({ type: 'generateConfig', payload: {} });

    expect(viewer).not.toHaveBeenCalled();
    expect(workspace.exists('/shaders/missing.sha.json')).toBe(false);
  });

  it('reloads the preview when the active shader config is edited', async () => {
    const host = await createHost();
    const viewer = vi.fn();
    host.onViewerMessage(viewer);
    await host.handleExplorerMessage({ type: 'activateShader', path: '/shaders/aurora.glsl' });
    viewer.mockClear();
    const edited = JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } });

    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: { path: '/shaders/aurora.sha.json', code: edited },
    });

    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderSource',
      path: '/shaders/aurora.glsl',
      config: { version: '1.0', passes: { Image: { inputs: {} } } },
    }));
  });
});

describe('standalone config errors', () => {
  it('reports an unparsable config with the shader source', async () => {
    const host = await createHost();
    const viewer = vi.fn();
    host.onViewerMessage(viewer);
    await host.handleExplorerMessage({ type: 'activateShader', path: '/shaders/aurora.glsl' });
    viewer.mockClear();

    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: { path: '/shaders/aurora.sha.json', code: '{ "passes": ' },
    });

    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderSource',
      path: '/shaders/aurora.glsl',
      config: null,
      configError: 'Failed to parse config: /shaders/aurora.sha.json',
    }));
  });

  it.each([
    ['a valid config', '/shaders/aurora.glsl'],
    ['no config at all', '/shaders/clouds.slang'],
  ])('sends no config error for %s', async (_label, shaderPath) => {
    const host = await createHost();
    const viewer = vi.fn();
    host.onViewerMessage(viewer);

    await host.handleExplorerMessage({ type: 'activateShader', path: shaderPath });

    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({ type: 'shaderSource', path: shaderPath }));
    const message = viewer.mock.calls.map(([entry]) => entry).find((entry) => entry.type === 'shaderSource');
    expect(message.configError).toBeUndefined();
  });

  it('clears the config error once the config parses again', async () => {
    const host = await createHost();
    const viewer = vi.fn();
    host.onViewerMessage(viewer);
    await host.handleExplorerMessage({ type: 'activateShader', path: '/shaders/aurora.glsl' });
    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: { path: '/shaders/aurora.sha.json', code: 'broken' },
    });
    viewer.mockClear();

    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: {
        path: '/shaders/aurora.sha.json',
        code: JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } }),
      },
    });

    const message = viewer.mock.calls.map(([entry]) => entry).find((entry) => entry.type === 'shaderSource');
    expect(message.configError).toBeUndefined();
    expect(message.config).toEqual({ version: '1.0', passes: { Image: { inputs: {} } } });
  });
});

describe('standalone compile modes', () => {
  async function activeHost() {
    const host = await createHost();
    await host.handleExplorerMessage({ type: 'activateShader', path: '/shaders/aurora.glsl' });
    const viewer = vi.fn();
    host.onViewerMessage(viewer);
    return { host, viewer };
  }

  it('holds edits back from the preview in manual mode until a compile is requested', async () => {
    const { host, viewer } = await activeHost();
    await host.handleViewerMessage({ type: 'setCompileMode', payload: { mode: 'manual' } });

    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: { path: '/shaders/aurora.glsl', code: 'manual edit' },
    });
    expect(viewer.mock.calls.filter(([message]) => message.type === 'shaderSource')).toHaveLength(0);

    await host.handleViewerMessage({ type: 'extensionCommand', payload: { command: 'manualCompile' } });
    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderSource', path: '/shaders/aurora.glsl', code: 'manual edit',
    }));
  });

  it.each(['hot', 'save'])('sends edits straight to the preview in %s mode', async (mode) => {
    const { host, viewer } = await activeHost();
    await host.handleViewerMessage({ type: 'setCompileMode', payload: { mode } });

    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: { path: '/shaders/aurora.glsl', code: `${mode} edit` },
    });

    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderSource', path: '/shaders/aurora.glsl', code: `${mode} edit`,
    }));
  });

  it('flushes edits held back in manual mode when switching back to hot', async () => {
    const { host, viewer } = await activeHost();
    await host.handleViewerMessage({ type: 'setCompileMode', payload: { mode: 'manual' } });

    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: { path: '/shaders/aurora.glsl', code: 'held-back edit' },
    });
    expect(viewer.mock.calls.filter(([message]) => message.type === 'shaderSource')).toHaveLength(0);

    viewer.mockClear();
    await host.handleViewerMessage({ type: 'setCompileMode', payload: { mode: 'hot' } });

    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderSource', path: '/shaders/aurora.glsl', code: 'held-back edit',
    }));
  });

  it('round-trips edits across hot -> manual -> hot without losing them', async () => {
    const { host, viewer } = await activeHost();

    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: { path: '/shaders/aurora.glsl', code: 'hot edit' },
    });
    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderSource', path: '/shaders/aurora.glsl', code: 'hot edit',
    }));

    viewer.mockClear();
    await host.handleViewerMessage({ type: 'setCompileMode', payload: { mode: 'manual' } });
    expect(viewer.mock.calls.filter(([message]) => message.type === 'shaderSource')).toHaveLength(0);

    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: { path: '/shaders/aurora.glsl', code: 'manual edit' },
    });
    expect(viewer.mock.calls.filter(([message]) => message.type === 'shaderSource')).toHaveLength(0);

    viewer.mockClear();
    await host.handleViewerMessage({ type: 'setCompileMode', payload: { mode: 'hot' } });
    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderSource', path: '/shaders/aurora.glsl', code: 'manual edit',
    }));
  });

  it('does not push held-back edits to the preview when switching to manual', async () => {
    const { host, viewer } = await activeHost();

    await host.handleViewerMessage({ type: 'setCompileMode', payload: { mode: 'manual' } });

    expect(viewer.mock.calls.filter(([message]) => message.type === 'shaderSource')).toHaveLength(0);
  });

  it('resumes live edits when manual mode is switched back to hot', async () => {
    const { host, viewer } = await activeHost();
    await host.handleViewerMessage({ type: 'setCompileMode', payload: { mode: 'manual' } });
    await host.handleViewerMessage({ type: 'setCompileMode', payload: { mode: 'hot' } });

    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: { path: '/shaders/aurora.glsl', code: 'live again' },
    });

    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({ type: 'shaderSource', code: 'live again' }));
  });

  it('applies config edits in manual mode without waiting for a compile', async () => {
    const { host, viewer } = await activeHost();
    await host.handleViewerMessage({ type: 'setCompileMode', payload: { mode: 'manual' } });

    await host.handleViewerMessage({
      type: 'updateShaderSource',
      payload: {
        path: '/shaders/aurora.sha.json',
        code: JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } }),
      },
    });

    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shaderSource',
      path: '/shaders/aurora.glsl',
      config: { version: '1.0', passes: { Image: { inputs: {} } } },
    }));
  });

  it('ignores a manual compile request with no active shader', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
    const host = new WebExtensionHost(workspace);
    const viewer = vi.fn();
    host.onViewerMessage(viewer);

    await host.handleViewerMessage({ type: 'extensionCommand', payload: { command: 'manualCompile' } });

    expect(viewer).not.toHaveBeenCalled();
  });
});

describe('standalone layout profiles', () => {
  const profileData = {
    theme: 'light',
    layout: { grid: { root: 'preview' } },
    configPanel: { isVisible: true },
    debugPanel: { isVisible: false },
    performancePanel: { isVisible: true },
  };

  it('stores and reads back a profile and its index', async () => {
    const host = await createHost();
    const viewer = vi.fn();
    host.onViewerMessage(viewer);

    await host.handleViewerMessage({ type: 'profile:writeProfile', id: 'debugging', data: profileData });
    await host.handleViewerMessage({
      type: 'profile:writeIndex',
      index: { active: 'debugging', order: [{ id: 'default', name: 'Default' }, { id: 'debugging', name: 'Debugging' }] },
    });
    await host.handleViewerMessage({ type: 'profile:readIndex', requestId: 'r1' });
    await host.handleViewerMessage({ type: 'profile:readProfile', id: 'debugging', requestId: 'r2' });

    expect(viewer).toHaveBeenCalledWith({
      type: 'profile:indexData',
      requestId: 'r1',
      index: { active: 'debugging', order: [{ id: 'default', name: 'Default' }, { id: 'debugging', name: 'Debugging' }] },
    });
    expect(viewer).toHaveBeenCalledWith({ type: 'profile:profileData', requestId: 'r2', data: profileData });
  });

  it('survives a reload of the workspace', async () => {
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, []);
    const host = new WebExtensionHost(workspace);
    await host.handleViewerMessage({ type: 'profile:writeProfile', id: 'default', data: profileData });
    await host.handleViewerMessage({ type: 'profile:writeIndex', index: { active: 'default', order: [{ id: 'default', name: 'Default' }] } });
    await workspace.flush();

    const reloaded = new WebExtensionHost(await VirtualWorkspace.open(store, []));
    const viewer = vi.fn();
    reloaded.onViewerMessage(viewer);
    await reloaded.handleViewerMessage({ type: 'profile:readProfile', id: 'default', requestId: 'r1' });

    expect(viewer).toHaveBeenCalledWith({ type: 'profile:profileData', requestId: 'r1', data: profileData });
  });

  it('reports no index and no profile before anything is saved', async () => {
    const host = await createHost();
    const viewer = vi.fn();
    host.onViewerMessage(viewer);

    await host.handleViewerMessage({ type: 'profile:readIndex', requestId: 'r1' });
    await host.handleViewerMessage({ type: 'profile:readProfile', id: 'missing', requestId: 'r2' });

    expect(viewer).toHaveBeenCalledWith({ type: 'profile:indexData', requestId: 'r1', index: null });
    expect(viewer).toHaveBeenCalledWith({ type: 'profile:profileData', requestId: 'r2', data: null });
  });

  it.each([
    ['a malformed index', '/.shader-studio/profiles/index.json', 'not json'],
    ['an index missing its fields', '/.shader-studio/profiles/index.json', '{"active":"default"}'],
  ])('reports no index for %s', async (_label, path, contents) => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
    workspace.writeText(path, contents);
    const host = new WebExtensionHost(workspace);
    const viewer = vi.fn();
    host.onViewerMessage(viewer);

    await host.handleViewerMessage({ type: 'profile:readIndex', requestId: 'r1' });

    expect(viewer).toHaveBeenCalledWith({ type: 'profile:indexData', requestId: 'r1', index: null });
  });

  it('reports no data for a malformed profile', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
    workspace.writeText('/.shader-studio/profiles/default.json', '{oops');
    const host = new WebExtensionHost(workspace);
    const viewer = vi.fn();
    host.onViewerMessage(viewer);

    await host.handleViewerMessage({ type: 'profile:readProfile', id: 'default', requestId: 'r1' });

    expect(viewer).toHaveBeenCalledWith({ type: 'profile:profileData', requestId: 'r1', data: null });
  });

  it('deletes a profile and leaves the others alone', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
    const host = new WebExtensionHost(workspace);
    await host.handleViewerMessage({ type: 'profile:writeProfile', id: 'default', data: profileData });
    await host.handleViewerMessage({ type: 'profile:writeProfile', id: 'debugging', data: profileData });

    await host.handleViewerMessage({ type: 'profile:deleteProfile', id: 'debugging' });
    await host.handleViewerMessage({ type: 'profile:deleteProfile', id: 'debugging' });

    expect(workspace.exists('/.shader-studio/profiles/debugging.json')).toBe(false);
    expect(workspace.exists('/.shader-studio/profiles/default.json')).toBe(true);
  });

  it.each(['../escape', 'nested/profile', '', 42])('rejects the unusable profile id %s', async (id) => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
    const host = new WebExtensionHost(workspace);
    const viewer = vi.fn();
    host.onViewerMessage(viewer);

    await host.handleViewerMessage({ type: 'profile:writeProfile', id, data: profileData });
    await host.handleViewerMessage({ type: 'profile:readProfile', id, requestId: 'r1' });

    expect(workspace.list('/').filter((file) => file.path.startsWith('/.shader-studio/profiles'))).toEqual([]);
    expect(viewer).toHaveBeenCalledWith({ type: 'profile:profileData', requestId: 'r1', data: null });
  });

  it('ignores profile writes with nothing to store', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
    const host = new WebExtensionHost(workspace);

    await host.handleViewerMessage({ type: 'profile:writeProfile', id: 'default' });
    await host.handleViewerMessage({ type: 'profile:writeIndex' });

    expect(workspace.list('/')).toEqual([]);
  });
});
