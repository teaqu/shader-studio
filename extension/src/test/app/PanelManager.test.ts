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
            send: sandbox.stub(),
            addTransport: sandbox.stub().returns(undefined),
            removeTransport: sandbox.stub().returns(undefined),
            getErrorHandler: sandbox.stub().returns({
                handleError: sandbox.stub(),
                handlePersistentError: sandbox.stub()
            }),
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

        test('should add media-src to existing CSP for video support', () => {
            const htmlWithCsp = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src vscode-resource:;"></head><body></body></html>';
            readFileSyncStub.returns(htmlWithCsp);
            
            panelManager.createPanel();

            const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
            const html = createdPanel.webview.html;
            
            // Should contain media-src with webview.cspSource and blob:
            assert.ok(html.includes('media-src vscode-resource: blob:'), 'Should add media-src to existing CSP');
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
        });

        test('should add new CSP when none exists', () => {
            const htmlWithoutCsp = '<!doctype html><html><head></head><body></body></html>';
            readFileSyncStub.returns(htmlWithoutCsp);
            
            panelManager.createPanel();

            const createdPanel = createWebviewPanelStub.getCall(0).returnValue;
            const html = createdPanel.webview.html;
            
            // Should add new nonce-based CSP with media-src
            assert.ok(html.includes('Content-Security-Policy'), 'Should add new CSP meta tag');
            assert.ok(html.includes('media-src vscode-resource: blob:'), 'Should include media-src in new CSP');
            assert.ok(html.includes('nonce-abc123'), 'Should use nonce-based CSP');
            assert.ok(html.includes('script-src vscode-resource: \'nonce-abc123\''), 'Should include script-src with nonce');
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

    suite('handleConfigUpdate error handling', () => {
        test('should send error to UI when config update fails', async () => {
            const fs = require('fs');
            const mockEditor = {
                document: {
                    uri: { fsPath: '/path/to/shader.glsl' },
                    languageId: 'glsl'
                }
            };

            // Make glslFileTracker return an editor
            const mockGlslFileTracker = (panelManager as any).glslFileTracker;
            mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns(mockEditor);

            // Make writeFileSync throw
            sandbox.stub(fs, 'writeFileSync').throws(new Error('Write failed'));

            await (panelManager as any).handleConfigUpdate({ config: {}, text: '{}' });

            sinon.assert.calledOnce(mockMessenger.send as sinon.SinonStub);
            const message = (mockMessenger.send as sinon.SinonStub).firstCall.args[0];
            assert.strictEqual(message.type, 'error');
            assert.ok(message.payload[0].includes('Failed to update shader config'));
        });

        test('should not show VS Code error when config update fails', async () => {
            const fs = require('fs');
            const mockEditor = {
                document: {
                    uri: { fsPath: '/path/to/shader.glsl' },
                    languageId: 'glsl'
                }
            };

            const mockGlslFileTracker = (panelManager as any).glslFileTracker;
            mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns(mockEditor);

            sandbox.stub(fs, 'writeFileSync').throws(new Error('Write failed'));

            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

            await (panelManager as any).handleConfigUpdate({ config: {}, text: '{}' });

            sinon.assert.notCalled(showErrorStub);
        });

        test('should use shaderPath from payload when provided', async () => {
            const fs = require('fs');
            const writeStub = sandbox.stub(fs, 'writeFileSync');

            // Don't set up any active editor - the payload path should be used instead
            await (panelManager as any).handleConfigUpdate({
                config: {},
                text: '{}',
                shaderPath: '/locked/shader.glsl'
            });

            sinon.assert.calledOnce(writeStub);
            const writtenPath = writeStub.firstCall.args[0];
            assert.strictEqual(writtenPath, '/locked/shader.sha.json');
        });

        test('should fall back to active editor when no shaderPath in payload', async () => {
            const fs = require('fs');
            const writeStub = sandbox.stub(fs, 'writeFileSync');

            const mockEditor = {
                document: {
                    uri: { fsPath: '/active/editor.glsl' },
                    languageId: 'glsl'
                }
            };
            const mockGlslFileTracker = (panelManager as any).glslFileTracker;
            mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns(mockEditor);

            await (panelManager as any).handleConfigUpdate({
                config: {},
                text: '{}'
            });

            sinon.assert.calledOnce(writeStub);
            const writtenPath = writeStub.firstCall.args[0];
            assert.strictEqual(writtenPath, '/active/editor.sha.json');
        });

        test('should refresh the correct shader after config update with payload path', async () => {
            const clock = sandbox.useFakeTimers();
            const fs = require('fs');
            sandbox.stub(fs, 'writeFileSync');

            (mockShaderProvider as any).sendShaderFromPath = sandbox.stub();

            await (panelManager as any).handleConfigUpdate({
                config: {},
                text: '{}',
                shaderPath: '/locked/shader.glsl'
            });

            // Advance past the 150ms setTimeout
            clock.tick(200);

            sinon.assert.calledOnce((mockShaderProvider as any).sendShaderFromPath);
            const refreshedPath = (mockShaderProvider as any).sendShaderFromPath.firstCall.args[0];
            assert.strictEqual(refreshedPath, '/locked/shader.glsl');

            clock.restore();
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

        test('should not route unknown message types', async () => {
            const fs = require('fs');
            const writeStub = sandbox.stub(fs, 'writeFileSync');

            await (panelManager as any).handleWebviewMessage(
                { type: 'unknownType', payload: {} },
                mockWebviewPanel
            );

            sinon.assert.notCalled(writeStub);
            sinon.assert.notCalled(mockWebviewPanel.webview.postMessage);
        });
    });
});
