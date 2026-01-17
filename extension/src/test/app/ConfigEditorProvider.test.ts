import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConfigEditorProvider } from '../../app/ConfigEditorProvider';

suite('ConfigEditorProvider Test Suite', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  function createMockWebviewPanel() {
    return {
      webview: {
        options: {},
        html: '',
        asWebviewUri: sandbox.stub().returns(vscode.Uri.file('/mock/uri')),
        postMessage: sandbox.stub(),
        onDidReceiveMessage: sandbox.stub().returns({ dispose: sandbox.stub() }),
      },
      onDidDispose: sandbox.stub().returns({ dispose: sandbox.stub() }),
      onDidChangeViewState: sandbox.stub().returns({ dispose: sandbox.stub() }),
      visible: true,
    } as any as vscode.WebviewPanel;
  }

  function createMockConfigDocument(configPath: string): vscode.TextDocument {
    return {
      uri: vscode.Uri.file(configPath),
      getText: sandbox.stub().returns('{ }'),
      lineCount: 1,
    } as any;
  }

  function createMockShaderEditor(shaderPath: string): vscode.TextEditor {
    return {
      document: {
        uri: vscode.Uri.file(shaderPath),
        fileName: shaderPath,
        languageId: 'glsl',
        getText: sandbox.stub().returns('// shader'),
      } as any,
    } as any;
  }

  test('should update running shader when config changes and shader editor is visible', async () => {
    const fs = require('fs');
    const clock = sandbox.useFakeTimers({ shouldClearNativeTimers: true } as any);

    const mockContext = {
      extensionPath: '/mock/extension/path',
    } as any as vscode.ExtensionContext;

    sandbox.stub(fs, 'readFileSync').returns('<html></html>');

    const configPath = '/mock/path/shader.sha.json';
    const configDocument = createMockConfigDocument(configPath);
    const expectedShaderPath = configDocument.uri.fsPath.replace(/\.sha\.json$/i, '.glsl');

    sandbox.stub(fs, 'existsSync').callsFake((p: any) => p === expectedShaderPath);

    const mockShaderProvider = {
      sendShaderToWebview: sandbox.stub(),
      sendShaderFromPath: sandbox.stub().resolves(),
    } as any;

    const provider = new ConfigEditorProvider(mockContext, mockShaderProvider);

    const webviewPanel = createMockWebviewPanel();

    const shaderEditor = createMockShaderEditor(expectedShaderPath);
    sandbox.stub(vscode.window, 'visibleTextEditors').value([shaderEditor]);

    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

    let onChangeCb: ((e: vscode.TextDocumentChangeEvent) => void) | undefined;
    sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').callsFake((cb: any) => {
      onChangeCb = cb;
      return { dispose: sandbox.stub() } as any;
    });

    await provider.resolveCustomTextEditor(configDocument, webviewPanel, {} as any);

    assert.ok(onChangeCb);
    onChangeCb!({ document: configDocument } as any);

    await clock.tickAsync(200);

    sinon.assert.calledOnce(mockShaderProvider.sendShaderToWebview);
    sinon.assert.calledWith(mockShaderProvider.sendShaderToWebview, shaderEditor);
    sinon.assert.notCalled(mockShaderProvider.sendShaderFromPath);
    sinon.assert.notCalled(executeCommandStub);
  });

  test('should refresh shader by path when config changes and shader editor is not visible', async () => {
    const fs = require('fs');
    const clock = sandbox.useFakeTimers({ shouldClearNativeTimers: true } as any);

    const mockContext = {
      extensionPath: '/mock/extension/path',
    } as any as vscode.ExtensionContext;

    sandbox.stub(fs, 'readFileSync').returns('<html></html>');
    const configPath = '/mock/path/shader.sha.json';

    const mockShaderProvider = {
      sendShaderToWebview: sandbox.stub(),
      sendShaderFromPath: sandbox.stub().resolves(),
    } as any;

    const provider = new ConfigEditorProvider(mockContext, mockShaderProvider);

    const configDocument = createMockConfigDocument(configPath);
    const expectedShaderPath = configDocument.uri.fsPath.replace(/\.sha\.json$/i, '.glsl');

    sandbox.stub(fs, 'existsSync').callsFake((p: any) => p === expectedShaderPath);
    const webviewPanel = createMockWebviewPanel();

    sandbox.stub(vscode.window, 'visibleTextEditors').value([]);

    let onChangeCb: ((e: vscode.TextDocumentChangeEvent) => void) | undefined;
    sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').callsFake((cb: any) => {
      onChangeCb = cb;
      return { dispose: sandbox.stub() } as any;
    });

    await provider.resolveCustomTextEditor(configDocument, webviewPanel, {} as any);

    assert.ok(onChangeCb);
    onChangeCb!({ document: configDocument } as any);

    await clock.tickAsync(200);

    sinon.assert.notCalled(mockShaderProvider.sendShaderToWebview);
    sinon.assert.calledWith(mockShaderProvider.sendShaderFromPath, expectedShaderPath);
  });
});
