import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ShaderExplorerBackend } from '../../app/ShaderExplorerBackend';
import { Logger } from '../../app/services/Logger';

suite('ShaderExplorerBackend Test Suite', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
    Logger.initialize({
      info: sandbox.stub(),
      debug: sandbox.stub(),
      trace: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      append: sandbox.stub(),
      appendLine: sandbox.stub(),
      clear: sandbox.stub(),
      show: sandbox.stub(),
      hide: sandbox.stub(),
      dispose: sandbox.stub(),
    } as any);

    const fs = require('fs');
    sandbox.stub(fs, 'mkdirSync').callsFake(() => undefined);
  });

  teardown(() => {
    sandbox.restore();
  });

  function createBackend() {
    const mockContext = {
      extensionPath: '/mock/extension/path',
      globalState: { get: sandbox.stub(), update: sandbox.stub().resolves() },
      workspaceState: { get: sandbox.stub(), update: sandbox.stub().resolves() },
      subscriptions: [],
      asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
      extensionMode: vscode.ExtensionMode.Test,
      extensionUri: vscode.Uri.file('/mock/extension/path'),
      globalStorageUri: vscode.Uri.file('/mock/global/storage'),
    } as any;
    const mockWebview = {
      postMessage: sandbox.stub(),
      asWebviewUri: sandbox.stub().callsFake((uri: vscode.Uri) => uri),
      cspSource: 'vscode-webview://test-source',
      html: '',
      onDidReceiveMessage: sandbox.stub(),
    } as any;
    const gitMetadataProvider = {
      getMetadataForWorkspace: sandbox.stub().resolves(null),
      clearCache: sandbox.stub(),
    };
    return new ShaderExplorerBackend(mockContext, mockWebview, gitMetadataProvider);
  }

  test('findAllShaders searches .wgsl files and lists WGSL shaders', async () => {
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 },
    ]);
    const wgslUri = vscode.Uri.file('/ws/image.wgsl');
    const findFilesStub = sandbox.stub(vscode.workspace, 'findFiles').resolves([wgslUri]);
    sandbox.stub(vscode.workspace, 'asRelativePath').callsFake((_pathOrUri: string | vscode.Uri) => 'image.wgsl');
    const fs = require('fs');
    sandbox.stub(fs, 'existsSync').returns(false);
    sandbox.stub(fs, 'statSync').returns({ mtimeMs: 1, birthtimeMs: 1 });
    sandbox.stub(fs, 'readFileSync').returns('fn mainImage(coord: vec2f) -> vec4f { return vec4f(1.0); }');

    const shaders = await (createBackend() as any).findAllShaders();

    const pattern = findFilesStub.firstCall.args[0] as vscode.RelativePattern;
    assert.ok(pattern.pattern.includes('wgsl'), `search pattern must cover wgsl: ${pattern.pattern}`);
    assert.ok(shaders.some((shader: { path?: string; fsPath?: string }) =>
      (shader.path ?? shader.fsPath ?? '').endsWith('image.wgsl')));
  });
});
