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
    
    // Mock filesystem operations to prevent ThumbnailCache from creating real directories
    const fs = require('fs');
    sandbox.stub(fs, 'existsSync').returns(true);
    sandbox.stub(fs, 'mkdirSync').callsFake((path: any, options?: any) => {
      // Mock implementation - do nothing
      return undefined;
    });
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');
    
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

  test('should call generateConfig on ConfigGenerator when generateConfig command is executed', async () => {
    // Mock the ConfigGenerator's generateConfig method
    const generateConfigSpy = sandbox.spy(shaderStudio['configGenerator'], 'generateConfig');

    // Get the command handler that was registered
    const registerCommandStub = vscode.commands.registerCommand as any;
    const generateConfigCall = registerCommandStub.getCalls().find((call: any) =>
      call.args[0] === 'shader-studio.generateConfig'
    );

    // Execute the command handler directly
    if (generateConfigCall && generateConfigCall.args[1]) {
      await generateConfigCall.args[1]();
    }

    // Verify the ConfigGenerator's generateConfig method was called
    sinon.assert.calledOnce(generateConfigSpy);
  });

  test('refreshSpecificShaderByPath should call sendShaderFromPath with forceCleanup', async () => {
    const shaderPath = '/mock/path/shader.glsl';
    const fs = require('fs');
    
    // fs.existsSync is already stubbed in setup to return true
    fs.readFileSync.returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}');

    const sendShaderFromPathSpy = sandbox.spy(shaderStudio['shaderProvider'], 'sendShaderFromPath');

    await shaderStudio['refreshSpecificShaderByPath'](shaderPath);

    sinon.assert.calledOnce(sendShaderFromPathSpy);
    sinon.assert.calledWith(sendShaderFromPathSpy, shaderPath, { forceCleanup: true });
  });

  test('refreshCurrentShader should call sendShaderFromPath with forceCleanup when no active GLSL editor', async () => {
    const lastViewedFile = '/mock/path/last-shader.glsl';
    const fs = require('fs');
    
    fs.readFileSync.returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}');

    // Set up last viewed file
    shaderStudio['glslFileTracker'].setLastViewedGlslFile(lastViewedFile);

    // Mock no active editor
    sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);

    const sendShaderFromPathSpy = sandbox.spy(shaderStudio['shaderProvider'], 'sendShaderFromPath');

    await shaderStudio['refreshCurrentShader']();

    sinon.assert.calledOnce(sendShaderFromPathSpy);
    sinon.assert.calledWith(sendShaderFromPathSpy, lastViewedFile, { forceCleanup: true });
  });

  test('refreshCurrentShader should call sendShaderToWebview with forceCleanup when active GLSL editor exists', async () => {
    const mockEditor = createMockGLSLEditor();

    // Mock active editor is a GLSL editor
    sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);

    // Reset the spy since it might have been called during setup
    sendShaderSpy.resetHistory();

    await shaderStudio['refreshCurrentShader']();

    sinon.assert.calledOnce(sendShaderSpy);
    sinon.assert.calledWith(sendShaderSpy, mockEditor, { forceCleanup: true });
  });

  test('toggleEditorOverlay command should send ToggleEditorOverlayMessage via messenger', () => {
    const messengerSendSpy = sandbox.spy(shaderStudio['messenger'], 'send');

    // Get the command handler that was registered
    const registerCommandStub = vscode.commands.registerCommand as any;
    const toggleOverlayCall = registerCommandStub.getCalls().find((call: any) =>
      call.args[0] === 'shader-studio.toggleEditorOverlay'
    );

    assert.ok(toggleOverlayCall, 'toggleEditorOverlay command should be registered');

    // Execute the command handler
    toggleOverlayCall.args[1]();

    // Verify it sent a ToggleEditorOverlayMessage
    const overlayCall = messengerSendSpy.getCalls().find(
      (call: sinon.SinonSpyCall) => call.args[0].type === 'toggleEditorOverlay'
    );
    assert.ok(overlayCall, 'Should send toggleEditorOverlay message');
    assert.strictEqual(overlayCall!.args[0].type, 'toggleEditorOverlay');
  });

  suite('sendCursorPosition debounce tests', () => {
    let clock: sinon.SinonFakeTimers;
    let messengerSendSpy: sinon.SinonSpy;
    let mockEditor: vscode.TextEditor;

    setup(() => {
      clock = sandbox.useFakeTimers();

      // Create mock editor with lineAt method
      mockEditor = createMockGLSLEditor();
      (mockEditor.document as any).lineAt = sandbox.stub().returns({
        text: '  vec2 uv = fragCoord / iResolution.xy;',
        range: new vscode.Range(5, 0, 5, 40),
        rangeIncludingLineBreak: new vscode.Range(5, 0, 6, 0),
        firstNonWhitespaceCharacterIndex: 2,
        isEmptyOrWhitespace: false,
      });

      mockEditor.selection = new vscode.Selection(5, 10, 5, 10);

      messengerSendSpy = sandbox.spy(shaderStudio['messenger'], 'send');
    });

    teardown(() => {
      clock.restore();
    });

    test('should debounce cursor position messages by default', () => {
      // Call sendCursorPosition with default debounce (true)
      shaderStudio['sendCursorPosition'](mockEditor);

      // Message should not be sent immediately
      sinon.assert.notCalled(messengerSendSpy);

      // Advance time by 149ms (just before the 150ms threshold)
      clock.tick(149);
      sinon.assert.notCalled(messengerSendSpy);

      // Advance time by 1ms more (total 150ms)
      clock.tick(1);
      sinon.assert.calledOnce(messengerSendSpy);

      // Verify the message contains cursor position data
      const message = messengerSendSpy.getCall(0).args[0];
      assert.strictEqual(message.type, 'cursorPosition');
      assert.strictEqual(message.payload.line, 5);
      assert.strictEqual(message.payload.character, 10);
      assert.strictEqual(message.payload.lineContent, '  vec2 uv = fragCoord / iResolution.xy;');
      assert.strictEqual(message.payload.filePath, '/mock/path/shader.glsl');
    });

    test('should send cursor position immediately when debounce is false', () => {
      // Call sendCursorPosition with debounce: false
      shaderStudio['sendCursorPosition'](mockEditor, false);

      // Message should be sent immediately without waiting
      sinon.assert.calledOnce(messengerSendSpy);

      const message = messengerSendSpy.getCall(0).args[0];
      assert.strictEqual(message.type, 'cursorPosition');
      assert.strictEqual(message.payload.line, 5);
      assert.strictEqual(message.payload.character, 10);
    });

    test('should cancel previous debounced call when called again before timeout', () => {
      // First call at position (5, 10)
      shaderStudio['sendCursorPosition'](mockEditor);

      // Advance time by 100ms (not enough to trigger)
      clock.tick(100);
      sinon.assert.notCalled(messengerSendSpy);

      // Move cursor to position (7, 15)
      mockEditor.selection = new vscode.Selection(7, 15, 7, 15);
      (mockEditor.document as any).lineAt = sandbox.stub().returns({
        text: '  fragColor = vec4(1.0);',
        range: new vscode.Range(7, 0, 7, 25),
        rangeIncludingLineBreak: new vscode.Range(7, 0, 8, 0),
        firstNonWhitespaceCharacterIndex: 2,
        isEmptyOrWhitespace: false,
      });

      // Second call (should cancel the first)
      shaderStudio['sendCursorPosition'](mockEditor);

      // Advance time by another 100ms (total 200ms from first call, 100ms from second)
      clock.tick(100);
      sinon.assert.notCalled(messengerSendSpy);

      // Advance time by 50ms more (150ms from second call)
      clock.tick(50);

      // Should only send the second position, not the first
      sinon.assert.calledOnce(messengerSendSpy);

      const message = messengerSendSpy.getCall(0).args[0];
      assert.strictEqual(message.payload.line, 7);
      assert.strictEqual(message.payload.character, 15);
      assert.strictEqual(message.payload.lineContent, '  fragColor = vec4(1.0);');
    });

    test('should handle rapid cursor movements and only send final position', () => {
      // Simulate rapid cursor movements
      for (let i = 0; i < 10; i++) {
        mockEditor.selection = new vscode.Selection(i, i * 2, i, i * 2);
        shaderStudio['sendCursorPosition'](mockEditor);
        clock.tick(50); // Each movement 50ms apart
      }

      // At this point, 500ms have passed, but only the last call should matter
      // The last call was at 450ms, so we need to wait 150ms from that point

      // No messages should have been sent yet (each call cancels the previous)
      sinon.assert.notCalled(messengerSendSpy);

      // Advance to 150ms after the last call
      clock.tick(100); // Total: 600ms, which is 150ms after the last call at 450ms

      // Should send only the final position
      sinon.assert.calledOnce(messengerSendSpy);

      const message = messengerSendSpy.getCall(0).args[0];
      assert.strictEqual(message.payload.line, 9);
      assert.strictEqual(message.payload.character, 18);
    });

    test('should allow multiple immediate sends when debounce is false', () => {
      // Call multiple times with debounce: false
      for (let i = 0; i < 5; i++) {
        mockEditor.selection = new vscode.Selection(i, i, i, i);
        shaderStudio['sendCursorPosition'](mockEditor, false);
      }

      // All 5 messages should be sent immediately
      sinon.assert.callCount(messengerSendSpy, 5);

      // Verify each message was sent with correct position
      for (let i = 0; i < 5; i++) {
        const message = messengerSendSpy.getCall(i).args[0];
        assert.strictEqual(message.payload.line, i);
        assert.strictEqual(message.payload.character, i);
      }
    });

    test('should use 150ms debounce delay', () => {
      shaderStudio['sendCursorPosition'](mockEditor);

      // Test specific timing
      clock.tick(149);
      sinon.assert.notCalled(messengerSendSpy);

      clock.tick(1); // Exactly 150ms
      sinon.assert.calledOnce(messengerSendSpy);
    });
  });

  suite('error messages sent to UI', () => {
    let messengerSendSpy: sinon.SinonSpy;

    setup(() => {
      messengerSendSpy = sandbox.spy(shaderStudio['messenger'], 'send');
    });

    test('refreshCurrentShader should send error to UI when no GLSL file available', async () => {
      // No active editor and no last viewed file
      sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
      shaderStudio['glslFileTracker'].setLastViewedGlslFile(null as any);

      await shaderStudio['refreshCurrentShader']();

      const errorCall = messengerSendSpy.getCalls().find(
        (call: sinon.SinonSpyCall) => call.args[0].type === 'error'
      );
      assert.ok(errorCall, 'Should send error message to UI');
      assert.deepStrictEqual(errorCall!.args[0].payload, ['No GLSL file to refresh. Open a .glsl file first.']);
    });

    test('refreshCurrentShader should not show VS Code warning when no GLSL file available', async () => {
      sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
      shaderStudio['glslFileTracker'].setLastViewedGlslFile(null as any);

      const showWarningStub = sandbox.stub(vscode.window, 'showWarningMessage');

      await shaderStudio['refreshCurrentShader']();

      sinon.assert.notCalled(showWarningStub);
    });

    test('refreshSpecificShaderByPath should send error to UI when file not found', async () => {
      const fs = require('fs');
      fs.existsSync.returns(false);

      await shaderStudio['refreshSpecificShaderByPath']('/nonexistent/shader.glsl');

      const errorCall = messengerSendSpy.getCalls().find(
        (call: sinon.SinonSpyCall) => call.args[0].type === 'error'
      );
      assert.ok(errorCall, 'Should send error message to UI');
      assert.ok(errorCall!.args[0].payload[0].includes('Shader file not found'));
    });

    test('refreshSpecificShaderByPath should not show VS Code warning when file not found', async () => {
      const fs = require('fs');
      fs.existsSync.returns(false);

      const showWarningStub = sandbox.stub(vscode.window, 'showWarningMessage');

      await shaderStudio['refreshSpecificShaderByPath']('/nonexistent/shader.glsl');

      sinon.assert.notCalled(showWarningStub);
    });

    test('refreshSpecificShaderByPath should send error to UI on exception', async () => {
      const fs = require('fs');
      fs.existsSync.returns(true);

      sandbox.stub(shaderStudio['shaderProvider'], 'sendShaderFromPath').rejects(new Error('Test error'));

      await shaderStudio['refreshSpecificShaderByPath']('/path/to/shader.glsl');

      const errorCall = messengerSendSpy.getCalls().find(
        (call: sinon.SinonSpyCall) => call.args[0].type === 'error'
      );
      assert.ok(errorCall, 'Should send error message to UI');
      assert.ok(errorCall!.args[0].payload[0].includes('Failed to refresh shader'));
    });

    test('refreshSpecificShaderByPath should not show VS Code error on exception', async () => {
      const fs = require('fs');
      fs.existsSync.returns(true);

      sandbox.stub(shaderStudio['shaderProvider'], 'sendShaderFromPath').rejects(new Error('Test error'));

      const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await shaderStudio['refreshSpecificShaderByPath']('/path/to/shader.glsl');

      sinon.assert.notCalled(showErrorStub);
    });
  });
});
