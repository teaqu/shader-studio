import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ShaderStudio } from '../../app/ShaderStudio';

suite('Shader Studio Test Suite', () => {
  let shaderStudio: ShaderStudio;
  let mockContext: vscode.ExtensionContext;
  let mockOutputChannel: vscode.LogOutputChannel;
  let mockDiagnosticCollection: vscode.DiagnosticCollection;
  let sandbox: sinon.SinonSandbox;
  let sendShaderSpy: sinon.SinonSpy;

  setup(() => {
    sandbox = sinon.createSandbox();
    mockOutputChannel = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      dispose: sandbox.stub(),
      appendLine: sandbox.stub(),
      append: sandbox.stub(),
      clear: sandbox.stub(),
      show: sandbox.stub(),
      hide: sandbox.stub(),
      name: 'Test Output',
      replace: sandbox.stub(),
    } as any;

    mockDiagnosticCollection = {
      set: sandbox.stub(),
      delete: sandbox.stub(),
      clear: sandbox.stub(),
      dispose: sandbox.stub(),
      name: 'Test Diagnostics',
      has: sandbox.stub().returns(false),
      get: sandbox.stub().returns([]),
      forEach: sandbox.stub(),
    } as any;

    mockContext = {
      extensionPath: '/mock/extension/path',
      globalState: {
        get: sandbox.stub().callsFake((key: string, defaultValue?: any) => defaultValue),
        update: sandbox.stub().resolves(),
        keys: sandbox.stub().returns([]),
        setKeysForSync: sandbox.stub()
      } as any,
      workspaceState: {
        get: sandbox.stub().callsFake((key: string, defaultValue?: any) => defaultValue),
        update: sandbox.stub().resolves(),
        keys: sandbox.stub().returns([]),
        setKeysForSync: sandbox.stub()
      } as any,
      subscriptions: [],
      asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
      extensionMode: vscode.ExtensionMode.Test,
      extension: {} as any,
      extensionUri: vscode.Uri.file('/mock/extension/path'),
      globalStorageUri: vscode.Uri.file('/mock/global/storage'),
      logUri: vscode.Uri.file('/mock/log'),
      storagePath: '/mock/storage',
      globalStoragePath: '/mock/global/storage',
      logPath: '/mock/log',
      secrets: {} as any,
      environmentVariableCollection: {} as any,
      storageUri: vscode.Uri.file('/mock/storage'),
      languageModelAccessInformation: {} as any,
    };

    sandbox.stub(vscode.workspace, 'workspaceFolders').value([]);
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: sandbox.stub().withArgs('webSocketPort').returns(51474 + Math.floor(Math.random() * 100))
    } as any);
    sandbox.stub(vscode.window, 'registerCustomEditorProvider').returns({
      dispose: sandbox.stub()
    } as any);
    sandbox.stub(vscode.commands, 'registerCommand').returns({
      dispose: sandbox.stub()
    } as any);

    shaderStudio = new ShaderStudio(mockContext, mockOutputChannel, mockDiagnosticCollection);
    sendShaderSpy = sandbox.spy(shaderStudio['shaderProvider'], 'sendShaderToWebview');
  });

  teardown(() => {
    sandbox.restore();
  });

  function createMockGLSLEditor(): vscode.TextEditor {
    const mockDocument = {
      fileName: '/mock/path/shader.glsl',
      languageId: 'glsl',
      uri: vscode.Uri.file('/mock/path/shader.glsl'),
      getText: sandbox.stub().returns('// Mock GLSL code'),
      lineCount: 10,
      isClosed: false,
      isDirty: false,
      isUntitled: false,
      save: sandbox.stub(),
      eol: vscode.EndOfLine.LF,
      version: 1,
    } as any;

    return {
      document: mockDocument,
      selection: new vscode.Selection(0, 0, 0, 0),
      selections: [new vscode.Selection(0, 0, 0, 0)],
      visibleRanges: [new vscode.Range(0, 0, 9, 0)],
      options: {
        cursorStyle: vscode.TextEditorCursorStyle.Line,
        insertSpaces: true,
        lineNumbers: vscode.TextEditorLineNumbersStyle.On,
        tabSize: 4
      },
      viewColumn: vscode.ViewColumn.One,
      edit: sandbox.stub(),
      insertSnippet: sandbox.stub(),
      setDecorations: sandbox.stub(),
      revealRange: sandbox.stub(),
      show: sandbox.stub(),
      hide: sandbox.stub(),
    } as any;
  }

  function createMockGLSLNoLanguageEditor(): vscode.TextEditor {
    const mockDocument = {
      fileName: '/mock/path/shader.glsl',
      languageId: 'plaintext',
      uri: vscode.Uri.file('/mock/path/shader.glsl'),
      getText: sandbox.stub().returns('// Mock GLSL code'),
      lineCount: 10,
      isClosed: false,
      isDirty: false,
      isUntitled: false,
      save: sandbox.stub(),
      eol: vscode.EndOfLine.LF,
      version: 1,
    } as any;

    return {
      document: mockDocument,
      selection: new vscode.Selection(0, 0, 0, 0),
      selections: [new vscode.Selection(0, 0, 0, 0)],
      visibleRanges: [new vscode.Range(0, 0, 9, 0)],
      options: {
        cursorStyle: vscode.TextEditorCursorStyle.Line,
        insertSpaces: true,
        lineNumbers: vscode.TextEditorLineNumbersStyle.On,
        tabSize: 4
      },
      viewColumn: vscode.ViewColumn.One,
      edit: sandbox.stub(),
      insertSnippet: sandbox.stub(),
      setDecorations: sandbox.stub(),
      revealRange: sandbox.stub(),
      show: sandbox.stub(),
      hide: sandbox.stub(),
    } as any;
  }

  test('should recommend GLSL highlighting extension when file is .glsl but languageId is missing', async () => {
    const mockWebviewPanel = {
      reveal: sandbox.stub(),
      webview: {
        html: '',
        asWebviewUri: sandbox.stub().returns(vscode.Uri.file('/mock/uri')),
        onDidReceiveMessage: sandbox.stub().returns({ dispose: () => { } }),
        postMessage: sandbox.stub(),
      },
      onDidDispose: sandbox.stub().returns({ dispose: () => { } }),
    };

    sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);

    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

    shaderStudio['panelManager'].createPanel();
    assert.strictEqual(shaderStudio['messenger'].hasActiveClients(), true);

    const mockEditor = createMockGLSLNoLanguageEditor();

    // Simulate no installed GLSL-related extensions
    sandbox.stub(vscode.extensions, 'all').value([]);
    sandbox.stub(vscode.extensions, 'getExtension').withArgs('slevesque.shader').returns(undefined as any);

    const showInfo = sandbox.stub(vscode.window, 'showInformationMessage' as any).resolves('Install "slevesque.shader"' as any);
    const exec = sandbox.stub(vscode.commands, 'executeCommand').resolves();

    // Call the recommendation helper directly to avoid event wiring timing issues in tests
    await shaderStudio['glslFileTracker'].recommendGlslHighlighter(mockEditor);

    sinon.assert.calledOnce(showInfo);
    sinon.assert.calledWith(exec, 'workbench.extensions.installExtension', 'slevesque.shader');
  });

  test('should allow disabling future recommendations via "Don\'t show again" option', async () => {
    const mockWebviewPanel = {
      reveal: sandbox.stub(),
      webview: {
        html: '',
        asWebviewUri: sandbox.stub().returns(vscode.Uri.file('/mock/uri')),
        onDidReceiveMessage: sandbox.stub().returns({ dispose: () => { } }),
        postMessage: sandbox.stub(),
      },
      onDidDispose: sandbox.stub().returns({ dispose: () => { } }),
    };

    sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);

    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

    shaderStudio['panelManager'].createPanel();
    assert.strictEqual(shaderStudio['messenger'].hasActiveClients(), true);

    const mockEditor = createMockGLSLNoLanguageEditor();

    // Simulate no installed GLSL-related extensions
    sandbox.stub(vscode.extensions, 'all').value([]);

    const showInfo = sandbox.stub(vscode.window, 'showInformationMessage' as any).resolves("Don't show again" as any);

    // Call the recommendation helper directly to avoid event wiring timing issues in tests
    await shaderStudio['glslFileTracker'].recommendGlslHighlighter(mockEditor);

    sinon.assert.calledOnce(showInfo);
    sinon.assert.calledWith(mockContext.globalState.update as sinon.SinonStub, 'suppressGlslHighlightRecommendation', true);
  });

  function createMockJavaScriptEditor(): vscode.TextEditor {
    const mockDocument = {
      fileName: '/mock/path/script.js',
      languageId: 'javascript',
      uri: vscode.Uri.file('/mock/path/script.js'),
      getText: sandbox.stub().returns('// Mock JS code'),
      lineCount: 10,
      isClosed: false,
      isDirty: false,
      isUntitled: false,
      save: sandbox.stub(),
      eol: vscode.EndOfLine.LF,
      version: 1,
    } as any;

    return {
      document: mockDocument,
      selection: new vscode.Selection(0, 0, 0, 0),
      selections: [new vscode.Selection(0, 0, 0, 0)],
      visibleRanges: [new vscode.Range(0, 0, 9, 0)],
      options: {
        cursorStyle: vscode.TextEditorCursorStyle.Line,
        insertSpaces: true,
        lineNumbers: vscode.TextEditorLineNumbersStyle.On,
        tabSize: 4
      },
      viewColumn: vscode.ViewColumn.One,
      edit: sandbox.stub(),
      insertSnippet: sandbox.stub(),
      setDecorations: sandbox.stub(),
      revealRange: sandbox.stub(),
      show: sandbox.stub(),
      hide: sandbox.stub(),
    } as any;
  }

  function simulateTextDocumentChange(editor: vscode.TextEditor): void {
    const textDocumentChangeHandlers = mockContext.subscriptions
      .filter((sub: any) => sub._listener && sub._event === 'onDidChangeTextDocument');

    if (textDocumentChangeHandlers.length > 0) {
      const changeEvent = { document: editor.document } as vscode.TextDocumentChangeEvent;
      textDocumentChangeHandlers.forEach((handler: any) => {
        if (handler._listener) {
          handler._listener(changeEvent);
        }
      });
    }
  }

  function simulateActiveEditorChange(editor: vscode.TextEditor): void {
    const activeEditorChangeHandlers = mockContext.subscriptions
      .filter((sub: any) => sub._listener && sub._event === 'onDidChangeActiveTextEditor');

    if (activeEditorChangeHandlers.length > 0) {
      activeEditorChangeHandlers.forEach((handler: any) => {
        if (handler._listener) {
          handler._listener(editor);
        }
      });
    }
  }

  test('should not process shader updates when no clients are connected', () => {
    const mockEditor = createMockGLSLEditor();

    assert.strictEqual(shaderStudio['messenger'].hasActiveClients(), false);
    simulateActiveEditorChange(mockEditor);
    sinon.assert.notCalled(sendShaderSpy);
  });

  test('should not process shader updates on text change when no clients are connected', () => {
    const mockEditor = createMockGLSLEditor();

    sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);
    assert.strictEqual(shaderStudio['messenger'].hasActiveClients(), false);
    simulateTextDocumentChange(mockEditor);
    sinon.assert.notCalled(sendShaderSpy);
  });

  test('performShaderUpdate method respects client connection status', () => {
    const mockEditor = createMockGLSLEditor();

    assert.strictEqual(shaderStudio['messenger'].hasActiveClients(), false);
    shaderStudio['performShaderUpdate'](mockEditor);
    sinon.assert.notCalled(sendShaderSpy);

    const mockWebviewPanel = {
      reveal: sandbox.stub(),
      webview: {
        html: '',
        asWebviewUri: sandbox.stub().returns(vscode.Uri.file('/mock/uri')),
        onDidReceiveMessage: sandbox.stub().returns({ dispose: () => { } }),
        postMessage: sandbox.stub(),
      },
      onDidDispose: sandbox.stub().returns({ dispose: () => { } }),
    };

    sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);

    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

    shaderStudio['panelManager'].createPanel();
    assert.strictEqual(shaderStudio['messenger'].hasActiveClients(), true);
    shaderStudio['performShaderUpdate'](mockEditor);
    sinon.assert.calledOnce(sendShaderSpy);
    sinon.assert.calledWith(sendShaderSpy, mockEditor);
  });

  test('should not process updates for non-GLSL files even with clients connected', () => {
    const mockWebviewPanel = {
      reveal: sandbox.stub(),
      webview: {
        html: '',
        asWebviewUri: sandbox.stub().returns(vscode.Uri.file('/mock/uri')),
        onDidReceiveMessage: sandbox.stub().returns({ dispose: () => { } }),
        postMessage: sandbox.stub(),
      },
      onDidDispose: sandbox.stub().returns({ dispose: () => { } }),
    };

    sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);

    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

    shaderStudio['panelManager'].createPanel();
    assert.strictEqual(shaderStudio['messenger'].hasActiveClients(), true);

    const mockEditor = createMockJavaScriptEditor();
    assert.strictEqual(shaderStudio['isGlslEditor'](mockEditor), false);

    const glslEditor = createMockGLSLEditor();
    assert.strictEqual(shaderStudio['isGlslEditor'](glslEditor), true);
  });

  test('should process .glsl file even when languageId is not glsl', () => {
    const mockWebviewPanel = {
      reveal: sandbox.stub(),
      webview: {
        html: '',
        asWebviewUri: sandbox.stub().returns(vscode.Uri.file('/mock/uri')),
        onDidReceiveMessage: sandbox.stub().returns({ dispose: () => { } }),
        postMessage: sandbox.stub(),
      },
      onDidDispose: sandbox.stub().returns({ dispose: () => { } }),
    };

    sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);

    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

    shaderStudio['panelManager'].createPanel();
    assert.strictEqual(shaderStudio['messenger'].hasActiveClients(), true);

    const mockEditor = createMockGLSLNoLanguageEditor();
    sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);
    shaderStudio['performShaderUpdate'](mockEditor);
    sinon.assert.calledOnce(sendShaderSpy);
    sinon.assert.calledWith(sendShaderSpy, mockEditor);
  });

  test('should open settings when openSettings command is executed', async () => {
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    
    // Execute the command directly on the shaderStudio instance
    await shaderStudio['openSettings']();
    
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWith(executeCommandStub, 'workbench.action.openSettings', '^shader-studio.');
  });
});
