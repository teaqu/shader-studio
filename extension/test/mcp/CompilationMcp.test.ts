import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { ShaderConfig } from '@shader-studio/types';
import { fileURLToPath } from 'node:url';
import { CompileController } from '../../src/app/CompileController';
import type { GlslFileTracker } from '../../src/app/GlslFileTracker';
import { ShaderProvider } from '../../src/app/ShaderProvider';
import type { Messenger } from '../../src/app/transport/Messenger';
import { mcpEditGuard } from '../../src/app/mcp/McpEditGuard';

const state = vi.hoisted(() => ({
  activeTextEditor: undefined as vscode.TextEditor | undefined,
  config: null as ShaderConfig | null,
  hasUniforms: true,
  poll: vi.fn(),
}));
vi.mock('vscode', () => ({
  window: { get activeTextEditor() {
    return state.activeTextEditor;
  }, visibleTextEditors: [] },
  workspace: { textDocuments: [], getWorkspaceFolder: () => undefined },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
}));
vi.mock('../../src/app/services/Logger', () => ({ Logger: { getInstance: () => ({ debug() {}, warn() {} }) } }));
vi.mock('../../src/app/ShaderConfigProcessor', () => ({ ShaderConfigProcessor: class {
  loadAndProcessConfig() {
    return state.config;
  }
  getConfigError() {
    return undefined;
  }
} }));
vi.mock('../../src/app/ScriptEvaluator', () => ({ ScriptEvaluator: class {
  dispose() {}
  loadScript() {
    return { declarations: 'uniform float speed;', uniforms: [{ name: 'speed', type: 'float' }] };
  }
  hasUniforms() {
    return state.hasUniforms;
  }
  startPolling = state.poll;
} }));
vi.mock('../../src/app/ScriptBundler', () => ({ ScriptBundler: class {
  async bundle() {
    return { success: true, code: 'bundled uniform script' };
  }
} }));
vi.mock('../../src/language-services/ShaderAuthoringEnvironmentProvider', () => ({ clearCustomUniformSnapshot: vi.fn(), publishCustomUniformSnapshot: vi.fn() }));

const shaderPath = '/workspace/main.glsl';
const dependencyPath = '/workspace/controls.glsl';
// The bundle seam is mocked; this existing file satisfies the provider's
// script existence check without creating a shared temporary fixture.
const scriptPath = fileURLToPath(import.meta.url);
function document(fileName: string, code = 'void mainImage(out vec4 color, vec2 pixel) { color = vec4(1.0); }'): vscode.TextDocument {
  return { fileName, uri: { fsPath: fileName }, languageId: fileName.endsWith('.glsl') ? 'glsl' : 'plaintext', getText: () => code } as vscode.TextDocument;
}
function controller() {
  const provider = { sendShaderFromDocument: vi.fn(), sendShaderWithScriptContent: vi.fn(), getActiveConfig: vi.fn(), getScriptPath: vi.fn() };
  const tracker = { setLastViewedGlslFile: vi.fn(), getLastViewedGlslFile: vi.fn(() => shaderPath) };
  const messenger = { hasActiveClients: () => true };
  const context = { globalState: { get: () => undefined, update: vi.fn() } };
  const value = new CompileController(context as unknown as vscode.ExtensionContext, tracker as unknown as GlslFileTracker,
    provider as unknown as ShaderProvider, messenger as unknown as Messenger);
  return { value, provider, tracker };
}
function change(doc: vscode.TextDocument): vscode.TextDocumentChangeEvent {
  return { document: doc } as vscode.TextDocumentChangeEvent;
}

beforeEach(() => {
  vi.clearAllMocks(); state.activeTextEditor = undefined; state.config = null; state.hasUniforms = true;
});
afterEach(() => mcpEditGuard.clear(dependencyPath));

describe('MCP edit compile suppression', () => {
  it('suppresses duplicate dependency events for a selected preview, then resumes ordinary editing', () => {
    const { value, provider, tracker } = controller();
    const edited = document(dependencyPath, 'vec3 controls() { return vec3(1.0); }');
    mcpEditGuard.arm(dependencyPath, edited.getText(), shaderPath);
    expect(value.handleTextDocumentChange(change(edited))).toBe(true);
    expect(value.handleTextDocumentChange(change(edited))).toBe(true);
    expect(provider.sendShaderFromDocument).not.toHaveBeenCalled();
    expect(tracker.setLastViewedGlslFile).not.toHaveBeenCalled();

    const manualEdit = document(dependencyPath, '// user edit');
    state.activeTextEditor = { document: manualEdit } as vscode.TextEditor;
    expect(value.handleTextDocumentChange(change(manualEdit))).toBe(false);
    expect(provider.sendShaderFromDocument).toHaveBeenCalledExactlyOnceWith(manualEdit);
    expect(tracker.setLastViewedGlslFile).toHaveBeenCalledExactlyOnceWith(dependencyPath);
  });

  it('suppresses the empty create transition without changing the active shader', () => {
    const { value, provider } = controller();
    mcpEditGuard.armSuppression(dependencyPath, 'created');
    expect(value.handleTextDocumentChange(change(document(dependencyPath, '')))).toBe(true);
    expect(value.handleTextDocumentChange(change(document(dependencyPath, 'created')))).toBe(true);
    expect(provider.sendShaderFromDocument).not.toHaveBeenCalled();
  });

  it('leaves unguarded shaders and non-shader documents on their normal compile paths', () => {
    const { value, provider, tracker } = controller();
    const shader = document(shaderPath);
    expect(value.handleTextDocumentChange(change(shader))).toBe(false);
    expect(provider.sendShaderFromDocument).toHaveBeenCalledExactlyOnceWith(shader);
    expect(tracker.setLastViewedGlslFile).not.toHaveBeenCalled();
    const script = document('/workspace/controls.js', 'export const value = 1;');
    provider.getScriptPath.mockReturnValue(script.fileName);
    expect(value.handleTextDocumentChange(change(script))).toBe(false);
    expect(provider.sendShaderWithScriptContent).toHaveBeenCalledExactlyOnceWith(shaderPath, script.getText());
    value.setMode('manual');
    expect(value.handleTextDocumentChange(change(script))).toBe(false);
    expect(value.handleTextDocumentChange(change(document('/workspace/notes.txt')))).toBe(false);
    expect(provider.sendShaderWithScriptContent).toHaveBeenCalledOnce();
  });
});

describe('MCP shader delivery', () => {
  it.each([undefined, 'selected-preview'])('routes both source and subsequent uniform values to %s', async previewId => {
    const send = vi.fn(async () => {});
    const messenger = { send, getErrorHandler: () => ({ clearPersistentErrors() {} }), getWebview: () => undefined };
    const provider = new ShaderProvider(messenger as unknown as Messenger);
    state.config = { version: '1.0', passes: { Image: {} }, script: scriptPath, scriptMaxPollingFps: 20 };
    await provider.sendShaderFromDocument(document(shaderPath), { previewId, reload: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'shaderSource', path: shaderPath, reload: true }), previewId);
    expect(state.poll).toHaveBeenCalledWith(expect.any(Function), 50);
    const values = [{ name: 'speed', value: 2 }];
    state.poll.mock.calls[0][0](values);
    expect(send).toHaveBeenLastCalledWith({ type: 'customUniformValues', payload: { values } }, previewId);
  });

  it('waits for targeted source delivery before starting script polling', async () => {
    state.config = { version: '1.0', passes: { Image: {} }, script: scriptPath };
    let deliver!: () => void;
    const send = vi.fn(() => new Promise<void>(resolve => {
      deliver = resolve;
    }));
    const messenger = { send, getErrorHandler: () => ({ clearPersistentErrors() {} }), getWebview: () => undefined };
    const provider = new ShaderProvider(messenger as unknown as Messenger);
    const pending = provider.sendShaderFromDocument(document(shaderPath), { previewId: 'selected-preview' });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(state.poll).not.toHaveBeenCalled();
    deliver(); await pending;
    expect(state.poll).toHaveBeenCalledWith(expect.any(Function), 33);
  });

  it('does not start polling when the shader has no custom uniforms', async () => {
    state.hasUniforms = false;
    const send = vi.fn(async () => {});
    const messenger = { send, getErrorHandler: () => ({ clearPersistentErrors() {} }), getWebview: () => undefined };
    await new ShaderProvider(messenger as unknown as Messenger).sendShaderFromDocument(document(shaderPath));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'shaderSource' }), undefined);
    expect(state.poll).not.toHaveBeenCalled();
  });
});
