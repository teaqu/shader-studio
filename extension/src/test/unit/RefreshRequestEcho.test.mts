import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShaderSourceMessage } from '@shader-studio/types';

// The viewer tags an owner refresh with an id; the host must carry it from the
// refresh message through the refresh command to the shaderSource it sends.
const vscodeApi = vi.hoisted(() => ({
  commands: { executeCommand: vi.fn(async () => undefined), registerCommand: vi.fn() },
  window: { activeTextEditor: undefined as unknown, visibleTextEditors: [] as unknown[] },
  workspace: { textDocuments: [] as unknown[], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
}));
vi.mock('vscode', () => vscodeApi);
const fsApi = vi.hoisted(() => ({ existsSync: vi.fn(() => true), readFileSync: vi.fn(() => '{}') }));
vi.mock('fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('fs')>()), ...fsApi }));

import { MessageHandler } from '../../app/transport/MessageHandler.js';
import { ShaderStudio } from '../../app/ShaderStudio.js';
import { ShaderProvider } from '../../app/ShaderProvider.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('owner refresh request id from the viewer to the host command', () => {
  beforeEach(() => vscodeApi.commands.executeCommand.mockClear());

  function handle(payload: Record<string, unknown>): void {
    const handler = new MessageHandler(logger as never, {} as never);
    handler.handleMessage({ type: 'refresh', payload } as never);
  }

  it('forwards the id with a path refresh', () => {
    handle({ path: '/owner.glsl', refreshRequestId: 3 });
    expect(vscodeApi.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      'shader-studio.refreshSpecificShaderByPath', '/owner.glsl', { refreshRequestId: 3 },
    );
  });

  it('forwards the id with a current-shader refresh, alongside an initial reload choice', () => {
    handle({ reason: 'initial', refreshRequestId: 8 });
    expect(vscodeApi.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      'shader-studio.refreshCurrentShader', { reload: false, refreshRequestId: 8 },
    );
  });

  it('passes no options when the refresh carries neither an id nor a reason', () => {
    handle({ path: '/owner.glsl' });
    expect(vscodeApi.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      'shader-studio.refreshSpecificShaderByPath', '/owner.glsl',
    );
  });
});

describe('owner refresh request id from the refresh command to the send', () => {
  function studio() {
    const shaderProvider = {
      sendShaderFromPath: vi.fn(async () => undefined),
      sendShaderFromEditor: vi.fn(async () => undefined),
      claimActiveAnalysisContext: vi.fn(),
    };
    const glslFileTracker = {
      getLastViewedGlslFile: vi.fn(() => '/last.glsl'),
      setLastViewedGlslFile: vi.fn(),
      isGlslEditor: vi.fn(() => true),
    };
    const instance = Object.assign(Object.create(ShaderStudio.prototype), {
      logger, shaderProvider, glslFileTracker, messenger: { send: vi.fn() },
    }) as ShaderStudio;
    return { instance, shaderProvider };
  }

  beforeEach(() => {
    vscodeApi.window.activeTextEditor = undefined;
  });

  it('echoes the id on a specific-path refresh and keeps the default reload', async () => {
    const { instance, shaderProvider } = studio();
    await instance['refreshSpecificShaderByPath']('/owner.glsl', { refreshRequestId: 4 });
    expect(shaderProvider.sendShaderFromPath).toHaveBeenCalledExactlyOnceWith('/owner.glsl', { reload: true, refreshRequestId: 4 });
  });

  it('leaves the id off a refresh nobody tagged', async () => {
    const { instance, shaderProvider } = studio();
    await instance['refreshSpecificShaderByPath']('/owner.glsl', { reload: false });
    expect(shaderProvider.sendShaderFromPath).toHaveBeenCalledExactlyOnceWith('/owner.glsl', { reload: false });
  });

  it('echoes the id when refreshing the active editor', async () => {
    const { instance, shaderProvider } = studio();
    const editor = { document: { fileName: '/active.glsl', uri: { fsPath: '/active.glsl' } } };
    vscodeApi.window.activeTextEditor = editor;
    await instance['refreshCurrentShader']({ refreshRequestId: 5 });
    expect(shaderProvider.sendShaderFromEditor).toHaveBeenCalledExactlyOnceWith(editor, { reload: true, refreshRequestId: 5 });
  });

  it('echoes the id when falling back to the last viewed file', async () => {
    const { instance, shaderProvider } = studio();
    await instance['refreshCurrentShader']({ refreshRequestId: 6 });
    expect(shaderProvider.sendShaderFromPath).toHaveBeenCalledExactlyOnceWith('/last.glsl', { reload: true, refreshRequestId: 6 });
  });
});

describe('owner refresh request id on the sent shaderSource', () => {
  function provider() {
    const send = vi.fn(async (_message: ShaderSourceMessage) => undefined);
    const instance = Object.assign(Object.create(ShaderProvider.prototype), {
      messenger: { send, getWebview: () => null },
      logger,
      preparationGenerations: new Map<string, number>(),
      activeAnalysisContexts: new Map(),
      configProcessor: { loadAndProcessConfig: () => null, getConfigError: () => undefined },
      configChangeClassifier: { recordSentConfig: vi.fn() },
      bundleScript: vi.fn(async () => true),
      startScriptPolling: vi.fn(),
      refreshPreparedCursorPosition: (cursor: unknown) => cursor,
      getDebugModeEnabled: () => false,
    }) as ShaderProvider;
    return { instance, send };
  }

  it.each([[11, { refreshRequestId: 11 }], [undefined, {}]])(
    'stamps a main shader with refresh id %s only when requested',
    async (refreshRequestId, expected) => {
      const { instance, send } = provider();
      await instance['sendMainImageShader']('/owner.glsl', 'void mainImage() {}', { reload: true, refreshRequestId });
      expect(send).toHaveBeenCalledOnce();
      const message = send.mock.calls[0][0];
      expect(message).toMatchObject({ type: 'shaderSource', path: '/owner.glsl', ...expected });
      expect('refreshRequestId' in message).toBe(refreshRequestId !== undefined);
    },
  );

  it.each([[12, { refreshRequestId: 12 }], [undefined, {}]])(
    'stamps a helper file with refresh id %s only when requested',
    (refreshRequestId, expected) => {
      const { instance } = provider();
      const message = instance['buildNonMainImageShaderMessage']('/helper.glsl', 'float f() { return 1.0; }', { refreshRequestId });
      expect(message).toMatchObject({ type: 'shaderSource', path: '/helper.glsl', ...expected });
      expect('refreshRequestId' in message).toBe(refreshRequestId !== undefined);
    },
  );
});
