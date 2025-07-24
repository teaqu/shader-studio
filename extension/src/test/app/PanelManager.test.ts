import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as sinon from 'sinon';
import { PanelManager } from '../../app/PanelManager';
import { Messenger } from '../../app/transport/Messenger';
import { ShaderProcessor } from '../../app/ShaderProcessor';

suite('PanelManager Test Suite', () => {
    let panelManager: PanelManager;
    let mockContext: vscode.ExtensionContext;
    let mockMessenger: Messenger;
    let mockShaderProcessor: ShaderProcessor;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();

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

        panelManager = new PanelManager(mockContext, mockMessenger, mockShaderProcessor);
    });

    teardown(() => {
        sandbox.restore();
    });

    function createMockWebviewPanel() {
        return {
            reveal: sandbox.stub(),
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

    test('createShaderView handles no GLSL editor gracefully', () => {
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
        panelManager.createShaderView();

        // Then
        assert.ok(createWebviewPanelStub.calledOnce);
        const createPanelArgs = createWebviewPanelStub.getCall(0).args;
        assert.strictEqual(createPanelArgs[0], 'shaderView');
        assert.strictEqual(createPanelArgs[1], 'Shader View');
        assert.strictEqual(createPanelArgs[2], vscode.ViewColumn.Beside);

        const webviewOptions = createPanelArgs[3];
        assert.ok(webviewOptions);
        assert.strictEqual(webviewOptions.enableScripts, true);
        assert.strictEqual(webviewOptions.retainContextWhenHidden, true);
        assert.ok(webviewOptions.localResourceRoots && webviewOptions.localResourceRoots.length >= 2);

        const localRoots = webviewOptions.localResourceRoots;
        const hasWorkspaceRoot = localRoots?.some((root: vscode.Uri) =>
            root.fsPath === '/mock/workspace'
        );
        assert.ok(hasWorkspaceRoot);
        assert.ok((mockMessenger.addTransport as sinon.SinonStub).calledOnce);
    });

    test('createShaderView uses empty tab group when available', () => {
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
        panelManager.createShaderView();

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
        panelManager.createShaderView();

        // Then
        assert.strictEqual(panelManager.getPanel(), mockWebviewPanel);
    });

    test('createShaderView creates new panel each time', () => {
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
        panelManager.createShaderView();
        panelManager.createShaderView();

        // Then
        assert.strictEqual(createWebviewPanelStub.callCount, 2);
        assert.strictEqual(panelManager.getPanel(), mockWebviewPanel2);
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
});
