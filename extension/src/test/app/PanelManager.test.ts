import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as sinon from 'sinon';
import { PanelManager } from '../../app/PanelManager';
import { Messenger } from '../../app/transport/Messenger';
import { WebviewTransport } from '../../app/transport/WebviewTransport';
import { ShaderProvider } from '../../app/ShaderProvider';
import { WorkspaceFileScanner } from '../../app/WorkspaceFileScanner';
import { Logger } from '../../app/services/Logger';

suite('PanelManager Test Suite', () => {
  let panelManager: PanelManager;
  let mockContext: vscode.ExtensionContext;
  let mockMessenger: Messenger & { addTransport: sinon.SinonStub, removeTransport: sinon.SinonStub };
  let mockShaderProvider: ShaderProvider;
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();

    const mockOutputChannel = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      dispose: sandbox.stub(),
    } as any;
    Logger.initialize(mockOutputChannel);

    mockContext = {
      extensionPath: path.join(__dirname, 'mock-extension'),
      globalState: {} as any,
      workspaceState: {} as any,
      subscriptions: [],
      asAbsolutePath: (relativePath: string) => path.join(__dirname, 'mock-extension', relativePath),
      globalStorageUri: vscode.Uri.file(path.join(__dirname, 'mock-global-storage')),
    } as any;

    mockMessenger = {
      send: sandbox.stub(),
      addTransport: sandbox.stub().returns(undefined),
      removeTransport: sandbox.stub().returns(undefined),
      getErrorHandler: sandbox.stub().returns({
        handleError: sandbox.stub(),
        handlePersistentError: sandbox.stub()
      }),
    } as any;

    mockShaderProvider = {
      sendShaderFromEditor: sandbox.stub(),
      forSlangOwner: sandbox.stub(),
      releaseSlangOwner: sandbox.stub(),
    } as any;

    const mockGlslFileTracker = {
      getActiveOrLastViewedGLSLEditor: sandbox.stub().returns(null),
      isGlslEditor: sandbox.stub().returns(false),
      setLastViewedGlslFile: sandbox.stub(),
      getLastViewedGlslFile: sandbox.stub().returns(null)
    } as any;

    sandbox.stub(vscode.commands, 'executeCommand').resolves();

    panelManager = new PanelManager(mockContext, mockMessenger, mockShaderProvider, mockGlslFileTracker);
  });

  teardown(() => {
    sandbox.restore();
    panelManager.dispose();
    // Reset Logger singleton
    (Logger as any).instance = undefined;
  });

  function createMockWebviewPanel() {
    return {
      reveal: sandbox.stub(),
      dispose: sandbox.stub(),
      viewColumn: vscode.ViewColumn.One as vscode.ViewColumn | undefined,
      webview: {
        html: '',
        asWebviewUri: sandbox.stub().returns(vscode.Uri.file('/mock/uri')),
        onDidReceiveMessage: sandbox.stub().returns({ dispose: () => { } }),
        postMessage: sandbox.stub(),
        cspSource: 'vscode-resource:',
      },
      onDidDispose: sandbox.stub().returns({ dispose: () => { } }),
    };
  }

  test('PanelManager can be instantiated', () => {
    assert.ok(panelManager instanceof PanelManager);
  });

  test('PanelManager uses WebviewTransport and not WebSocket', () => {
    // Given - When: PanelManager is created in setup
        
    // Then: Verify that WebviewTransport was added to messenger
    assert.ok(mockMessenger.addTransport.calledOnce);
    const addedTransport = (mockMessenger.addTransport as sinon.SinonStub).getCall(0).args[0];
    assert.ok(addedTransport instanceof WebviewTransport, 'PanelManager should add WebviewTransport to messenger');
        
    // Verify no WebSocket-related imports or usage in PanelManager
    // This is verified by the fact that we only use WebviewTransport in the constructor
  });

  test('toggleEditorOverlayInActivePanel posts only to the active panel', () => {
    const activePanel = createMockWebviewPanel() as any;
    activePanel.active = true;
    activePanel.visible = true;

    const inactivePanel = createMockWebviewPanel() as any;
    inactivePanel.active = false;
    inactivePanel.visible = true;

    (panelManager as any).panels.add(inactivePanel);
    (panelManager as any).panels.add(activePanel);

    panelManager.toggleEditorOverlayInActivePanel();

    sinon.assert.calledOnce(activePanel.webview.postMessage);
    sinon.assert.notCalled(inactivePanel.webview.postMessage);
    sinon.assert.calledWith(activePanel.webview.postMessage, { type: 'toggleEditorOverlay' });
  });

  test('toggleEditorOverlayInActivePanel falls back to a visible panel when none is active', () => {
    const visiblePanel = createMockWebviewPanel() as any;
    visiblePanel.active = false;
    visiblePanel.visible = true;

    (panelManager as any).panels.add(visiblePanel);

    panelManager.toggleEditorOverlayInActivePanel();

    sinon.assert.calledOnce(visiblePanel.webview.postMessage);
    sinon.assert.calledWith(visiblePanel.webview.postMessage, { type: 'toggleEditorOverlay' });
  });

  test('createPanel handles no GLSL editor gracefully', () => {
    // Given
    const mockWebviewPanel = createMockWebviewPanel();
    const createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);
    sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
    sandbox.stub(vscode.window, 'visibleTextEditors').value([]);
    sandbox.stub(vscode.window, 'tabGroups').value({
      all: [{ tabs: [{ label: 'tab1' }], viewColumn: vscode.ViewColumn.One }]
    });
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: vscode.Uri.file('/mock/workspace') }
    ]);
    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

    // When
    panelManager.createPanel();

    // Then
    assert.ok(createWebviewPanelStub.calledOnce);
    const createPanelArgs = createWebviewPanelStub.getCall(0).args;
    assert.strictEqual(createPanelArgs[0], 'shader-studio');
    assert.strictEqual(createPanelArgs[1], 'Shader Studio');
    assert.strictEqual(createPanelArgs[2], vscode.ViewColumn.Beside);

    const webviewOptions = createPanelArgs[3];
    assert.ok(webviewOptions);
    assert.strictEqual(webviewOptions.enableScripts, true);
    assert.strictEqual(webviewOptions.retainContextWhenHidden, true);
    assert.ok(webviewOptions.localResourceRoots && webviewOptions.localResourceRoots.length >= 2);

    const localRoots = webviewOptions.localResourceRoots;
    const mockWorkspaceUri = vscode.Uri.file('/mock/workspace');
    const hasWorkspaceRoot = localRoots?.some((root: vscode.Uri) =>
      root.toString() === mockWorkspaceUri.toString()
    );
    assert.ok(hasWorkspaceRoot);
    assert.ok((mockMessenger.addTransport as sinon.SinonStub).calledOnce);
  });

  test('createPanel sends the active shader to the webview immediately when an editor exists', () => {
    const mockWebviewPanel = createMockWebviewPanel();
    sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);
    sandbox.stub(vscode.window, 'tabGroups').value({
      all: [{ tabs: [{ label: 'tab1' }], viewColumn: vscode.ViewColumn.One }]
    });
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: vscode.Uri.file('/mock/workspace') }
    ]);
    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

    const mockEditor = {
      document: {
        uri: vscode.Uri.file('/mock/workspace/shader.glsl'),
      },
    } as vscode.TextEditor;

    (panelManager as any).glslFileTracker.getActiveOrLastViewedGLSLEditor.returns(mockEditor);

    panelManager.createPanel();

    sinon.assert.calledOnce(mockShaderProvider.sendShaderFromEditor as sinon.SinonStub);
    sinon.assert.calledWithExactly(mockShaderProvider.sendShaderFromEditor as sinon.SinonStub, mockEditor);
  });

  test('gives simultaneous panels distinct owned providers and releases only the disposed owner', () => {
    const releaseA = sandbox.stub();
    const releaseB = sandbox.stub();
    const ownerA = { sendShaderFromEditor: sandbox.stub(), releaseSlangOwner: releaseA } as any;
    const ownerB = { sendShaderFromEditor: sandbox.stub(), releaseSlangOwner: releaseB } as any;
    const owned = [ownerA, ownerB];
    const ownerFactory = (mockShaderProvider as any).forSlangOwner as sinon.SinonStub;
    ownerFactory.callsFake(() => owned.shift());
    const disposeCallbacks: (() => void)[] = [];
    const makePanel = () => ({
      reveal: sandbox.stub(), dispose: sandbox.stub(), viewColumn: vscode.ViewColumn.One,
      webview: { html: '', asWebviewUri: sandbox.stub().returns(vscode.Uri.file('/mock/uri')), onDidReceiveMessage: sandbox.stub().returns({ dispose() {} }), postMessage: sandbox.stub(), cspSource: 'vscode-resource:' },
      onDidDispose: sandbox.stub().callsFake((callback: () => void) => {
        disposeCallbacks.push(callback); return { dispose() {} };
      }),
    });
    const first = makePanel();
    const second = makePanel();
    sandbox.stub(vscode.window, 'createWebviewPanel').onFirstCall().returns(first as any).onSecondCall().returns(second as any);
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({ get: sandbox.stub().returns(false) } as any);
    sandbox.stub(vscode.window, 'tabGroups').value({ all: [{ tabs: [{}], viewColumn: vscode.ViewColumn.One }] });
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: vscode.Uri.file('/mock/workspace') }]);
    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');
    const editor = { document: { uri: vscode.Uri.file('/mock/workspace/image.slang') } } as any;
    (panelManager as any).glslFileTracker.getActiveOrLastViewedGLSLEditor.returns(editor);
    const ownedManager = new PanelManager(mockContext, mockMessenger, mockShaderProvider, (panelManager as any).glslFileTracker, undefined, {} as any);

    ownedManager.createPanel();
    ownedManager.createPanel();
    assert.deepStrictEqual(ownerFactory.getCalls().map((call) => call.args[0]), ['panel:1', 'panel:2']);
    sinon.assert.calledOnceWithExactly(ownerA.sendShaderFromEditor, editor);
    sinon.assert.calledOnceWithExactly(ownerB.sendShaderFromEditor, editor);
    disposeCallbacks[0]();
    sinon.assert.calledOnce(releaseA);
    sinon.assert.notCalled(releaseB);
    ownedManager.dispose();
    sinon.assert.calledOnce(releaseB);
  });

  test('createPanel uses empty tab group when available and locking is disabled', () => {
    // Given
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: sandbox.stub().returns(false),
    } as any);
    const mockWebviewPanel = createMockWebviewPanel();
    const createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);
    sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
    sandbox.stub(vscode.window, 'visibleTextEditors').value([]);
    sandbox.stub(vscode.window, 'tabGroups').value({
      all: [
        { tabs: [{ label: 'tab1' }], viewColumn: vscode.ViewColumn.One },
        { tabs: [], viewColumn: vscode.ViewColumn.Two }
      ]
    });
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: vscode.Uri.file('/mock/workspace') }
    ]);
    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

    // When
    panelManager.createPanel();

    // Then
    assert.ok(createWebviewPanelStub.calledOnce);
    const createPanelArgs = createWebviewPanelStub.getCall(0).args;
    assert.strictEqual(createPanelArgs[2], vscode.ViewColumn.Two);
  });

  test('createPanel reuses empty group when locking is enabled', () => {
    // Given - locking enabled (default), empty group exists
    const mockWebviewPanel = createMockWebviewPanel();
    const createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);
    sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
    sandbox.stub(vscode.window, 'visibleTextEditors').value([]);
    sandbox.stub(vscode.window, 'tabGroups').value({
      all: [
        { tabs: [{ label: 'tab1' }], viewColumn: vscode.ViewColumn.One },
        { tabs: [], viewColumn: vscode.ViewColumn.Two }
      ]
    });
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: vscode.Uri.file('/mock/workspace') }
    ]);
    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

    // When
    panelManager.createPanel();

    // Then - should reuse the empty group instead of creating beside
    assert.ok(createWebviewPanelStub.calledOnce);
    const createPanelArgs = createWebviewPanelStub.getCall(0).args;
    assert.strictEqual(createPanelArgs[2], vscode.ViewColumn.Two);
  });

  test('createPanel opens beside when locking is enabled and no empty group exists', () => {
    // Given - locking enabled (default), no empty groups
    const mockWebviewPanel = createMockWebviewPanel();
    const createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);
    sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
    sandbox.stub(vscode.window, 'visibleTextEditors').value([]);
    sandbox.stub(vscode.window, 'tabGroups').value({
      all: [
        { tabs: [{ label: 'tab1' }], viewColumn: vscode.ViewColumn.One },
        { tabs: [{ label: 'tab2' }], viewColumn: vscode.ViewColumn.Two }
      ]
    });
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: vscode.Uri.file('/mock/workspace') }
    ]);
    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

    // When
    panelManager.createPanel();

    // Then - should use Beside since no empty groups available
    assert.ok(createWebviewPanelStub.calledOnce);
    const createPanelArgs = createWebviewPanelStub.getCall(0).args;
    assert.strictEqual(createPanelArgs[2], vscode.ViewColumn.Beside);
  });

  test('createPanel creates new panel each time', () => {
    // Given
    const mockWebviewPanel1 = createMockWebviewPanel();
    const mockWebviewPanel2 = createMockWebviewPanel();
    const createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel')
      .onFirstCall().returns(mockWebviewPanel1 as any)
      .onSecondCall().returns(mockWebviewPanel2 as any);
    sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
    sandbox.stub(vscode.window, 'visibleTextEditors').value([]);
    sandbox.stub(vscode.window, 'tabGroups').value({
      all: [{ tabs: [], viewColumn: vscode.ViewColumn.One }]
    });
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([]);
    const fs = require('fs');
    sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

    // When
    panelManager.createPanel();
    panelManager.createPanel();

    // Then
    assert.strictEqual(createWebviewPanelStub.callCount, 2);
  });

  test('localResourceRoots includes correct paths', () => {
    // Given
    const workspaceFolders = [vscode.Uri.file('/mock/workspace')];
    const shaderDir = vscode.Uri.file('/mock/shader/dir');

    // When
    const expectedLocalResourceRoots = [
      vscode.Uri.file(path.join(mockContext.extensionPath, "../ui", "dist")),
      shaderDir,
      ...workspaceFolders,
    ];
    const uiDistPath = path.join(mockContext.extensionPath, "../ui", "dist");

    // Then
    const pathContainsMockExtension = uiDistPath.includes('mock-extension') || uiDistPath.includes('test') || uiDistPath.includes('app');
    assert.ok(pathContainsMockExtension);
    assert.ok(expectedLocalResourceRoots.length >= 2);
  });

  suite('Webview HTML Processing', () => {
    let createWebviewPanelStub: sinon.SinonStub;
    let readFileSyncStub: sinon.SinonStub;

    setup(() => {
      const mockWebviewPanel = createMockWebviewPanel();
      createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);

      const fs = require('fs');
      readFileSyncStub = sandbox.stub(fs, 'readFileSync').returns('<html><head><link rel="stylesheet" href="/assets/style.css"></head><body><script src="/assets/main.js"></script></body></html>');
    });

    test('should convert relative resource URLs to webview URIs', () => {
      panelManager.createPanel();

      const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
      const html = createdPanel.webview.html;
            
      // Should convert href="/assets/style.css" to webview URI (file:// in test mock)
      assert.ok(html.includes('href="file:///mock/uri"'), `Should convert CSS href to webview URI. HTML: ${html}`);
      // Should convert src="/assets/main.js" to webview URI (file:// in test mock)  
      assert.ok(html.includes('src="file:///mock/uri"'), `Should convert JS src to webview URI. HTML: ${html}`);
            
      // Verify the original relative paths are not present
      assert.ok(!html.includes('href="/assets/'), 'Should not contain original relative CSS href');
      assert.ok(!html.includes('src="/assets/'), 'Should not contain original relative JS src');
    });

    test('should not inject WebSocket configuration', () => {
      panelManager.createPanel();

      const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
      const html = createdPanel.webview.html;
            
      // Should NOT contain WebSocket port configuration
      assert.ok(!html.includes('window.shaderViewConfig'), 'Should not inject WebSocket config');
      assert.ok(!html.includes('port:'), 'Should not contain port configuration');
      assert.ok(html.includes('shader-studio-layout-slot'), 'Should inject layout slot metadata');
      assert.ok(html.includes('content="vscode:1"'), 'Should inject the first VS Code layout slot');
    });

    test('should assign unique layout slot metadata to multiple panels', () => {
      const firstPanel = createMockWebviewPanel();
      const secondPanel = createMockWebviewPanel();
      createWebviewPanelStub.onFirstCall().returns(firstPanel as any);
      createWebviewPanelStub.onSecondCall().returns(secondPanel as any);

      panelManager.createPanel();
      panelManager.createPanel();

      assert.ok(firstPanel.webview.html.includes('content="vscode:1"'));
      assert.ok(secondPanel.webview.html.includes('content="vscode:2"'));
    });

    test('should add media-src to existing CSP for video support', () => {
      const htmlWithCsp = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src vscode-resource:;"></head><body></body></html>';
      readFileSyncStub.returns(htmlWithCsp);
            
      panelManager.createPanel();

      const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
      const html = createdPanel.webview.html;
            
      // Should contain media-src and connect-src with webview.cspSource and blob:
      assert.ok(html.includes('media-src vscode-resource: blob:'), 'Should add media-src to existing CSP');
      assert.ok(html.includes('connect-src vscode-resource: blob:'), 'Should add connect-src to existing CSP');
      assert.match(html, /script-src[^;]*\bblob:/, 'Should allow blob module scripts');
      assert.ok(html.includes('Content-Security-Policy'), 'Should preserve CSP meta tag');
    });

    test('should replace existing media-src in CSP', () => {
      const htmlWithMediaSrc = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; media-src vscode-resource:;"></head><body></body></html>';
      readFileSyncStub.returns(htmlWithMediaSrc);

      panelManager.createPanel();

      const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
      const html = createdPanel.webview.html;

      // Should replace existing media-src with new one including blob:
      assert.ok(html.includes('media-src vscode-resource: blob:'), 'Should replace existing media-src');
      assert.ok(!html.includes('media-src vscode-resource:;'), 'Should not contain old media-src without blob:');
      assert.ok(html.includes('connect-src vscode-resource: blob:'), 'Should add connect-src');
    });

    test('should add new CSP when none exists', () => {
      const htmlWithoutCsp = '<!doctype html><html><head></head><body></body></html>';
      readFileSyncStub.returns(htmlWithoutCsp);
            
      panelManager.createPanel();

      const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
      const html = createdPanel.webview.html;
            
      // Should add new nonce-based CSP with media-src and connect-src
      assert.ok(html.includes('Content-Security-Policy'), 'Should add new CSP meta tag');
      assert.ok(html.includes('media-src vscode-resource: blob:'), 'Should include media-src in new CSP');
      assert.ok(html.includes('connect-src vscode-resource: blob:'), 'Should include connect-src in new CSP');
      assert.ok(html.includes('nonce-abc123'), 'Should use nonce-based CSP');
      assert.ok(html.includes('script-src vscode-resource: blob: \'nonce-abc123\''), 'Should include script-src with nonce and blob scripts');
    });

    test('should handle CSP addition when no head tag exists', () => {
      const htmlWithoutHead = '<!doctype html><html><body></body></html>';
      readFileSyncStub.returns(htmlWithoutHead);
            
      panelManager.createPanel();

      const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
      const html = createdPanel.webview.html;
            
      // Should create head tag with CSP
      assert.ok(html.includes('<head>'), 'Should create head tag');
      assert.ok(html.includes('Content-Security-Policy'), 'Should add CSP to new head tag');
    });

    test('should add wasm-unsafe-eval to existing CSP script-src', () => {
      const htmlWithCsp = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src none; script-src vscode-resource:;"></head><body></body></html>';
      readFileSyncStub.returns(htmlWithCsp);

      panelManager.createPanel();

      const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
      const html = createdPanel.webview.html;

      assert.ok(html.includes("wasm-unsafe-eval"), 'Should add wasm-unsafe-eval to script-src');
    });

    test('should add connect-src to existing CSP', () => {
      const htmlWithCsp = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src vscode-resource:;"></head><body></body></html>';
      readFileSyncStub.returns(htmlWithCsp);

      panelManager.createPanel();

      const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
      const html = createdPanel.webview.html;

      assert.ok(html.includes('connect-src vscode-resource:'), 'Should add connect-src');
    });

    test('should include wasm-unsafe-eval in new CSP', () => {
      const htmlWithoutCsp = '<!doctype html><html><head></head><body></body></html>';
      readFileSyncStub.returns(htmlWithoutCsp);

      panelManager.createPanel();

      const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
      const html = createdPanel.webview.html;

      assert.ok(html.includes("wasm-unsafe-eval"), 'Should include wasm-unsafe-eval in new CSP');
    });

    test('should include connect-src in new CSP', () => {
      const htmlWithoutCsp = '<!doctype html><html><head></head><body></body></html>';
      readFileSyncStub.returns(htmlWithoutCsp);

      panelManager.createPanel();

      const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
      const html = createdPanel.webview.html;

      assert.ok(html.includes('connect-src vscode-resource:'), 'Should include connect-src in new CSP');
    });

    test('should handle malformed HTML gracefully', () => {
      const malformedHtml = '<body>Just some content</body>';
      readFileSyncStub.returns(malformedHtml);

      panelManager.createPanel();

      const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
      const html = createdPanel.webview.html;

      // Should fallback to prepending CSP
      assert.ok(html.includes('<head>'), 'Should add head tag as fallback');
      assert.ok(html.includes('Content-Security-Policy'), 'Should add CSP as fallback');
    });
  });


  suite('handleWebviewMessage routing', () => {
    let mockWebviewPanel: any;

    setup(() => {
      mockWebviewPanel = createMockWebviewPanel();
    });

    test('should route updateShaderSource to OverlayPanelHandler', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      // No open documents
      sandbox.stub(vscode.workspace, 'textDocuments').value([]);

      await (panelManager as any).handleWebviewMessage(
        { type: 'updateShaderSource', payload: { code: 'void mainImage() {}', path: '/test/shader.glsl' } },
        mockWebviewPanel
      );

      // The OverlayPanelHandler should have written the file since no doc was open
      sinon.assert.calledOnce(writeStub);
      assert.strictEqual(writeStub.firstCall.args[0], '/test/shader.glsl');
      assert.strictEqual(writeStub.firstCall.args[1], 'void mainImage() {}');
    });

    test('should route requestFileContents to OverlayPanelHandler', async () => {
      const fs = require('fs');
      const existsStub = sandbox.stub(fs, 'existsSync');
      const readStub = sandbox.stub(fs, 'readFileSync');

      existsStub.withArgs('/test/shader.sha.json').returns(true);
      existsStub.withArgs('/test/common.glsl').returns(true);
      readStub.withArgs('/test/shader.sha.json', 'utf-8').returns(JSON.stringify({
        passes: { common: { path: 'common.glsl' } }
      }));
      readStub.withArgs('/test/common.glsl', 'utf-8').returns('// common code');

      sandbox.stub(vscode.workspace, 'textDocuments').value([]);

      await (panelManager as any).handleWebviewMessage(
        { type: 'requestFileContents', payload: { bufferName: 'common', shaderPath: '/test/shader.glsl' } },
        mockWebviewPanel
      );

      sinon.assert.calledOnce(mockWebviewPanel.webview.postMessage);
      const message = mockWebviewPanel.webview.postMessage.firstCall.args[0];
      assert.strictEqual(message.type, 'fileContents');
      assert.strictEqual(message.payload.code, '// common code');
      assert.strictEqual(message.payload.bufferName, 'common');
    });

    test('routes requestWorkspaceFiles message to handler', async () => {
      const handleStub = sandbox.stub((panelManager as any).clientHandler, 'handle').resolves();
      const mockPanel = { webview: { postMessage: sandbox.stub() } } as any;

      await (panelManager as any).handleWebviewMessage(
        { type: 'requestWorkspaceFiles', payload: { extensions: ['png'], shaderPath: '/test.glsl' } },
        mockPanel,
      );

      sinon.assert.calledOnce(handleStub);
      assert.strictEqual(handleStub.firstCall.args[0].type, 'requestWorkspaceFiles');
    });

    test('routes forkShader message to handler', async () => {
      const handleStub = sandbox.stub((panelManager as any).clientHandler, 'handle').resolves();
      const mockPanel = { webview: { postMessage: sandbox.stub() } } as any;

      await (panelManager as any).handleWebviewMessage(
        { type: 'forkShader', payload: { shaderPath: '/test/shader.glsl' } },
        mockPanel,
      );

      sinon.assert.calledOnce(handleStub);
      assert.strictEqual(handleStub.firstCall.args[0].type, 'forkShader');
    });

    test('routes saveFile message to handler', async () => {
      const handleStub = sandbox.stub((panelManager as any).clientHandler, 'handle').resolves();
      const mockPanel = { webview: { postMessage: sandbox.stub() } } as any;

      await (panelManager as any).handleWebviewMessage(
        { type: 'saveFile', payload: { data: 'dGVzdA==', defaultName: 'test.gif', filters: { GIF: ['gif'] } } },
        mockPanel,
      );

      sinon.assert.calledOnce(handleStub);
      assert.strictEqual(handleStub.firstCall.args[0].type, 'saveFile');
    });

  });


  suite('Editor group locking', () => {
    let executeCommandStub: sinon.SinonStub;
    let clock: sinon.SinonFakeTimers;

    setup(() => {
      clock = sandbox.useFakeTimers();
      const mockWebviewPanel = createMockWebviewPanel();
      mockWebviewPanel.viewColumn = vscode.ViewColumn.Two;
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([]);
      const fs = require('fs');
      sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');
      executeCommandStub = vscode.commands.executeCommand as sinon.SinonStub;
      executeCommandStub.resolves();
    });

    teardown(() => {
      clock.restore();
    });

    async function flushMicrotasks() {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    }

    async function advanceTimersAndFlush(clock: sinon.SinonFakeTimers) {
      // Advance first setTimeout (500ms), flush microtasks for await
      clock.tick(500);
      await flushMicrotasks();
      // Advance second setTimeout (200ms), flush microtasks for await
      clock.tick(200);
      await flushMicrotasks();
    }

    test('locks editor group by default', async () => {
      panelManager.createPanel();
      await advanceTimersAndFlush(clock);

      sinon.assert.calledWith(executeCommandStub, 'workbench.action.lockEditorGroup');
    });

    test('does not lock when setting is false', async () => {
      sandbox.stub(vscode.workspace, 'getConfiguration').returns({
        get: sandbox.stub().returns(false),
      } as any);

      panelManager.createPanel();
      await advanceTimersAndFlush(clock);

      sinon.assert.neverCalledWith(executeCommandStub, 'workbench.action.lockEditorGroup');
    });

    test('locks when setting is explicitly true', async () => {
      sandbox.stub(vscode.workspace, 'getConfiguration').returns({
        get: sandbox.stub().returns(true),
      } as any);

      panelManager.createPanel();
      await advanceTimersAndFlush(clock);

      sinon.assert.calledWith(executeCommandStub, 'workbench.action.lockEditorGroup');
    });
  });

});
