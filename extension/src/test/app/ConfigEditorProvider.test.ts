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

  test('change subscription updates webview state without triggering shader refresh (refresh now owned by ShaderStudio)', async () => {
    const fs = require('fs');

    const mockContext = {
      extensionPath: '/mock/extension/path',
    } as any as vscode.ExtensionContext;

    sandbox.stub(fs, 'readFileSync').returns('<html></html>');

    const configPath = '/mock/path/shader.sha.json';
    const configDocument = createMockConfigDocument(configPath);

    const mockShaderProvider = {
      sendShaderFromEditor: sandbox.stub(),
      sendShaderFromPath: sandbox.stub().resolves(),
    } as any;

    const provider = new ConfigEditorProvider(mockContext, mockShaderProvider);
    const webviewPanel = createMockWebviewPanel();

    let onChangeCb: ((e: vscode.TextDocumentChangeEvent) => void) | undefined;
    sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').callsFake((cb: any) => {
      onChangeCb = cb;
      return { dispose: sandbox.stub() } as any;
    });

    await provider.resolveCustomTextEditor(configDocument, webviewPanel, {} as any);

    assert.ok(onChangeCb);
    onChangeCb!({ document: configDocument } as any);

    sinon.assert.notCalled(mockShaderProvider.sendShaderFromEditor);
    sinon.assert.notCalled(mockShaderProvider.sendShaderFromPath);
    sinon.assert.called(webviewPanel.webview.postMessage as sinon.SinonStub);
  });

  suite('addNewEntry - dynamic buffer naming', () => {
    test('should add BufferA when no buffers exist', async () => {
      const fs = require('fs');

      const mockContext = {
        extensionPath: '/mock/extension/path',
      } as any as vscode.ExtensionContext;

      sandbox.stub(fs, 'readFileSync').returns('<html></html>');
      sandbox.stub(fs, 'existsSync').returns(false);

      const mockShaderProvider = {
        sendShaderFromEditor: sandbox.stub(),
        sendShaderFromPath: sandbox.stub().resolves(),
      } as any;

      const provider = new ConfigEditorProvider(mockContext, mockShaderProvider);

      const configJson = { passes: { Image: { inputs: {} } } };
      const configDocument = {
        uri: vscode.Uri.file('/mock/path/shader.sha.json'),
        getText: sandbox.stub().returns(JSON.stringify(configJson)),
        lineCount: 1,
      } as any;

      const webviewPanel = createMockWebviewPanel();
      let applyEditStub = sandbox.stub(vscode.workspace, 'applyEdit').resolves(true);

      let messageHandler: ((e: any) => void) | undefined;
      (webviewPanel.webview.onDidReceiveMessage as sinon.SinonStub).callsFake((cb: any) => {
        messageHandler = cb;
        return { dispose: sandbox.stub() };
      });

      sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').callsFake(() => {
        return { dispose: sandbox.stub() } as any;
      });

      await provider.resolveCustomTextEditor(configDocument, webviewPanel, {} as any);

      assert.ok(messageHandler);
      messageHandler!({ type: 'add' });

      sinon.assert.calledOnce(applyEditStub);
      const edit = applyEditStub.firstCall.args[0] as vscode.WorkspaceEdit;
      const entries = edit.entries();
      assert.ok(entries.length > 0);
      const [, edits] = entries[0];
      const newText = (edits[0] as vscode.TextEdit).newText;
      const parsed = JSON.parse(newText);
      assert.ok(parsed.passes.BufferA, 'Should have added BufferA');
      assert.strictEqual(parsed.passes.BufferA.path, '');
      assert.deepStrictEqual(parsed.passes.BufferA.inputs, {});
    });

    test('should add BufferB when BufferA already exists', async () => {
      const fs = require('fs');

      const mockContext = {
        extensionPath: '/mock/extension/path',
      } as any as vscode.ExtensionContext;

      sandbox.stub(fs, 'readFileSync').returns('<html></html>');
      sandbox.stub(fs, 'existsSync').returns(false);

      const mockShaderProvider = {
        sendShaderFromEditor: sandbox.stub(),
        sendShaderFromPath: sandbox.stub().resolves(),
      } as any;

      const provider = new ConfigEditorProvider(mockContext, mockShaderProvider);

      const configJson = {
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'a.glsl', inputs: {} }
        }
      };
      const configDocument = {
        uri: vscode.Uri.file('/mock/path/shader.sha.json'),
        getText: sandbox.stub().returns(JSON.stringify(configJson)),
        lineCount: 1,
      } as any;

      const webviewPanel = createMockWebviewPanel();
      let applyEditStub = sandbox.stub(vscode.workspace, 'applyEdit').resolves(true);

      let messageHandler: ((e: any) => void) | undefined;
      (webviewPanel.webview.onDidReceiveMessage as sinon.SinonStub).callsFake((cb: any) => {
        messageHandler = cb;
        return { dispose: sandbox.stub() };
      });

      sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').callsFake(() => {
        return { dispose: sandbox.stub() } as any;
      });

      await provider.resolveCustomTextEditor(configDocument, webviewPanel, {} as any);

      assert.ok(messageHandler);
      messageHandler!({ type: 'add' });

      sinon.assert.calledOnce(applyEditStub);
      const edit = applyEditStub.firstCall.args[0] as vscode.WorkspaceEdit;
      const [, edits] = edit.entries()[0];
      const parsed = JSON.parse((edits[0] as vscode.TextEdit).newText);
      assert.ok(parsed.passes.BufferB, 'Should have added BufferB');
      assert.strictEqual(parsed.passes.BufferA.path, 'a.glsl');
    });

    test('should create passes object when document is empty', async () => {
      const fs = require('fs');

      const mockContext = {
        extensionPath: '/mock/extension/path',
      } as any as vscode.ExtensionContext;

      sandbox.stub(fs, 'readFileSync').returns('<html></html>');
      sandbox.stub(fs, 'existsSync').returns(false);

      const mockShaderProvider = {
        sendShaderFromEditor: sandbox.stub(),
        sendShaderFromPath: sandbox.stub().resolves(),
      } as any;

      const provider = new ConfigEditorProvider(mockContext, mockShaderProvider);

      const configDocument = {
        uri: vscode.Uri.file('/mock/path/shader.sha.json'),
        getText: sandbox.stub().returns('{ }'),
        lineCount: 1,
      } as any;

      const webviewPanel = createMockWebviewPanel();
      let applyEditStub = sandbox.stub(vscode.workspace, 'applyEdit').resolves(true);

      let messageHandler: ((e: any) => void) | undefined;
      (webviewPanel.webview.onDidReceiveMessage as sinon.SinonStub).callsFake((cb: any) => {
        messageHandler = cb;
        return { dispose: sandbox.stub() };
      });

      sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').callsFake(() => {
        return { dispose: sandbox.stub() } as any;
      });

      await provider.resolveCustomTextEditor(configDocument, webviewPanel, {} as any);

      assert.ok(messageHandler);
      messageHandler!({ type: 'add' });

      sinon.assert.calledOnce(applyEditStub);
      const edit = applyEditStub.firstCall.args[0] as vscode.WorkspaceEdit;
      const [, edits] = edit.entries()[0];
      const parsed = JSON.parse((edits[0] as vscode.TextEdit).newText);
      assert.ok(parsed.passes, 'Should have created passes object');
      assert.ok(parsed.passes.Image, 'Should have created Image pass');
      assert.ok(parsed.passes.BufferA, 'Should have added BufferA');
    });
  });

  test('should add out-of-workspace asset directories to localResourceRoots', async () => {
    const fs = require('fs');

    const mockContext = {
      extensionPath: '/mock/extension/path',
    } as any as vscode.ExtensionContext;

    sandbox.stub(fs, 'readFileSync').returns('<html></html>');
    sandbox.stub(fs, 'existsSync').returns(false);

    const mockShaderProvider = {
      sendShaderFromEditor: sandbox.stub(),
      sendShaderFromPath: sandbox.stub().resolves(),
    } as any;

    const provider = new ConfigEditorProvider(mockContext, mockShaderProvider);

    const configPath = '/mock/path/shader.sha.json';
    const downloadDir = '/mock/user/Downloads';
    const configJson = {
      passes: {
        Image: {
          inputs: {
            iChannel0: { type: 'texture', path: `${downloadDir}/texture.png` },
          },
        },
      },
    };
    const configDocument = {
      uri: vscode.Uri.file(configPath),
      getText: sandbox.stub().returns(JSON.stringify(configJson)),
      lineCount: 1,
    } as any;

    const webviewPanel = createMockWebviewPanel();
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file('/mock/extension/path/config-ui-dist')],
    };

    sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').callsFake(() => {
      return { dispose: sandbox.stub() } as any;
    });
    sandbox.stub(vscode.window, 'visibleTextEditors').value([]);

    await provider.resolveCustomTextEditor(configDocument, webviewPanel, {} as any);

    const roots = webviewPanel.webview.options.localResourceRoots || [];
    const fsPaths = roots.map((r: vscode.Uri) => r.fsPath);
    assert.ok(
      fsPaths.some((p: string) => p === downloadDir),
      `Expected ${downloadDir} in localResourceRoots, got: ${fsPaths.join(', ')}`
    );
  });
});
