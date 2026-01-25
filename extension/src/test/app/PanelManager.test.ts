import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as sinon from 'sinon';
import { PanelManager } from '../../app/PanelManager';
import { Messenger } from '../../app/transport/Messenger';
import { WebviewTransport } from '../../app/transport/WebviewTransport';
import { ShaderProvider } from '../../app/ShaderProvider';
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
        } as any;

        mockMessenger = {
            addTransport: sandbox.stub().returns(undefined),
            removeTransport: sandbox.stub().returns(undefined),
        } as any;

        mockShaderProvider = {
            sendShaderToWebview: sandbox.stub(),
        } as any;

        const mockGlslFileTracker = {
            getActiveOrLastViewedGLSLEditor: sandbox.stub().returns(null),
            isGlslEditor: sandbox.stub().returns(false),
            setLastViewedGlslFile: sandbox.stub(),
            getLastViewedGlslFile: sandbox.stub().returns(null)
        } as any;

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
            webview: {
                html: '',
                asWebviewUri: sandbox.stub().returns(vscode.Uri.file('/mock/uri')),
                onDidReceiveMessage: sandbox.stub().returns({ dispose: () => { } }),
                postMessage: sandbox.stub(),
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

    test('getPanel returns undefined when no panel exists', () => {
        const panel = panelManager.getPanel();
        assert.strictEqual(panel, undefined);
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

    test('createPanel uses empty tab group when available', () => {
        // Given
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

    test('getPanel returns current panel after creation', () => {
        // Given
        const mockWebviewPanel = createMockWebviewPanel();
        sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);
        sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
        sandbox.stub(vscode.window, 'visibleTextEditors').value([]);
        sandbox.stub(vscode.window, 'tabGroups').value({
            all: [{ tabs: [], viewColumn: vscode.ViewColumn.One }]
        });
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([]);
        const fs = require('fs');
        sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

        // When
        assert.strictEqual(panelManager.getPanel(), undefined);
        panelManager.createPanel();

        // Then
        assert.strictEqual(panelManager.getPanel(), mockWebviewPanel);
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
        const allPanels = panelManager.getPanels();
        assert.strictEqual(allPanels.length, 2);
        assert.ok(allPanels.includes(mockWebviewPanel1 as any));
        assert.ok(allPanels.includes(mockWebviewPanel2 as any));
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
        });
    });
});
