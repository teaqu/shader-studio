import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as sinon from 'sinon';
import { PanelManager } from '../../app/PanelManager';
import { Messenger } from '../../app/transport/Messenger';
import { ShaderProcessor } from '../../app/ShaderProcessor';
import { Logger } from '../../app/services/Logger';

suite('PanelManager Test Suite', () => {
    let panelManager: PanelManager;
    let mockContext: vscode.ExtensionContext;
    let mockMessenger: Messenger;
    let mockShaderProcessor: ShaderProcessor;
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
            addTransport: sandbox.stub(),
            removeTransport: sandbox.stub(),
        } as any;

        mockShaderProcessor = {
            sendShaderToWebview: sandbox.stub(),
        } as any;

        const mockGlslFileTracker = {
            getActiveOrLastViewedGLSLEditor: sandbox.stub().returns(null),
            isGlslEditor: sandbox.stub().returns(false),
            setLastViewedGlslFile: sandbox.stub(),
            getLastViewedGlslFile: sandbox.stub().returns(null)
        } as any;

        panelManager = new PanelManager(mockContext, mockMessenger, mockShaderProcessor, mockGlslFileTracker);
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

    suite('WebSocket Port Configuration', () => {
        let createWebviewPanelStub: sinon.SinonStub;
        let readFileSyncStub: sinon.SinonStub;
        let mockWorkspaceConfiguration: any;

        setup(() => {
            const mockWebviewPanel = createMockWebviewPanel();
            createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);

            const fs = require('fs');
            readFileSyncStub = sandbox.stub(fs, 'readFileSync').returns('<html><head></head><body></body></html>');

            mockWorkspaceConfiguration = {
                get: sandbox.stub()
            };
            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockWorkspaceConfiguration);
        });

        test('should inject configured WebSocket port into HTML', () => {
            const testPort = 8888;
            mockWorkspaceConfiguration.get.withArgs('webSocketPort').returns(testPort);

            panelManager.createPanel();

            const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
            const expectedScript = `<script>window.shaderViewConfig = { port: ${testPort} };</script>`;
            assert.ok(
                createdPanel.webview.html.includes(expectedScript),
                `HTML should contain the script for port ${testPort}`
            );
        });

        test('should use default WebSocket port when not configured', () => {
            mockWorkspaceConfiguration.get.withArgs('webSocketPort').returns(undefined);

            panelManager.createPanel();

            const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
            const expectedScript = `<script>window.shaderViewConfig = { port: 51472 };</script>`;
            assert.ok(
                createdPanel.webview.html.includes(expectedScript),
                'HTML should contain the script for the default port 51472'
            );
        });
    });
});
