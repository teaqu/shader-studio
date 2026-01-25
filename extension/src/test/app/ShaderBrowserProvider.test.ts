import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ShaderBrowserProvider } from '../../app/ShaderBrowserProvider';
import { ShaderConfigProcessor } from '../../app/ShaderConfigProcessor';

suite('ShaderBrowserProvider Test Suite', () => {
    let provider: ShaderBrowserProvider;
    let mockContext: vscode.ExtensionContext;
    let sandbox: sinon.SinonSandbox;
    let mockPanel: any;
    let mockWebview: any;
    let postMessageSpy: sinon.SinonSpy;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock filesystem operations to prevent ThumbnailCache from creating real directories
        const fs = require('fs');
        sandbox.stub(fs, 'existsSync').callsFake((...args: any[]) => {
            const path = args[0] as string;
            // Return false for HTML files to trigger error handling
            if (path.includes('index.html')) {
                return false;
            }
            return true;
        });
        sandbox.stub(fs, 'mkdirSync').callsFake((path: any, options?: any) => {
            // Mock implementation - do nothing
            return undefined;
        });
        sandbox.stub(fs, 'readFileSync').callsFake((...args: any[]) => {
            const path = args[0] as string;
            // Return mock HTML for HTML files
            if (path.includes('index.html')) {
                return '<html><head></head><body>Mock Shader Browser</body></html>';
            }
            return '<html><head></head><body></body></html>';
        });

        // Create mock webview
        postMessageSpy = sandbox.spy();
        mockWebview = {
            postMessage: postMessageSpy,
            asWebviewUri: (uri: vscode.Uri) => uri,
            html: '',
            onDidReceiveMessage: sandbox.stub(),
        };

        // Create mock panel
        mockPanel = {
            webview: mockWebview,
            reveal: sandbox.stub(),
            onDidDispose: sandbox.stub(),
            dispose: sandbox.stub(),
        };

        // Create mock context
        mockContext = {
            extensionPath: '/mock/extension/path',
            globalState: {
                get: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            workspaceState: {
                get: sandbox.stub().returns(null),
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

        provider = new ShaderBrowserProvider(mockContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    // Helper function to setup message handler
    function setupMessageHandler(panel: any): Function {
        let handler: Function | undefined;
        panel.webview.onDidReceiveMessage = (callback: Function) => {
            handler = callback;
            return { dispose: () => { } };
        };
        provider.show();
        if (!handler) {
            throw new Error('Message handler not registered');
        }
        return handler;
    }

    suite('Command Registration', () => {
        test('should register shader browser command', () => {
            const registerCommandStub = sandbox.stub(vscode.commands, 'registerCommand').returns({
                dispose: sandbox.stub()
            } as any);

            const disposable = ShaderBrowserProvider.register(mockContext);

            assert.ok(registerCommandStub.calledOnce);
            assert.strictEqual(registerCommandStub.firstCall.args[0], 'shader-studio.openShaderBrowser');
            assert.ok(disposable);
        });
    });

    suite('Panel Management', () => {
        test('should register message handler on show', () => {
            const createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

            let messageHandlerRegistered = false;
            mockPanel.webview.onDidReceiveMessage = () => {
                messageHandlerRegistered = true;
                return { dispose: () => { } };
            };

            provider.show();

            assert.ok(createWebviewPanelStub.calledOnce);
            assert.ok(messageHandlerRegistered);
        });

        test('should configure panel with correct view type and title', () => {
            const createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

            provider.show();

            assert.strictEqual(createWebviewPanelStub.firstCall.args[0], 'shader-studio.shaderBrowser');
            assert.strictEqual(createWebviewPanelStub.firstCall.args[1], 'Shader Browser');
        });

        test('should configure panel options correctly', () => {
            const createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([
                { uri: vscode.Uri.file('/workspace') }
            ]);

            provider.show();

            const options = createWebviewPanelStub.firstCall.args[3];
            assert.ok(options, 'Options should be defined');
            assert.strictEqual(options.enableScripts, true);
            assert.strictEqual(options.retainContextWhenHidden, true);
            assert.ok(Array.isArray(options.localResourceRoots));
            assert.ok(options.localResourceRoots.length > 0);
        });

        test('should reveal existing panel instead of creating new one', () => {
            const createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

            provider.show();
            provider.show();

            assert.strictEqual(createWebviewPanelStub.callCount, 1, 'Should only create panel once');
            assert.strictEqual(mockPanel.reveal.callCount, 1, 'Should reveal existing panel');
        });

        test('should handle multiple rapid show() calls', () => {
            const createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

            provider.show();
            provider.show();
            provider.show();

            assert.strictEqual(createWebviewPanelStub.callCount, 1, 'Should only create panel once');
            assert.strictEqual(mockPanel.reveal.callCount, 2, 'Should reveal twice');
        });

        test('should create new panel after dispose', () => {
            const createWebviewPanelStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            let disposeCallback: Function | undefined;
            mockPanel.onDidDispose = (callback: Function) => {
                disposeCallback = callback;
                return { dispose: () => { } };
            };

            provider.show();
            assert.ok(disposeCallback, 'Should register dispose callback');

            // Simulate panel disposal
            disposeCallback!();

            // Create new panel after disposal
            const newMockPanel: any = {
                webview: mockWebview,
                reveal: sandbox.stub(),
                onDidDispose: sandbox.stub(),
                dispose: sandbox.stub(),
            };
            createWebviewPanelStub.returns(newMockPanel);

            provider.show();
            assert.strictEqual(createWebviewPanelStub.callCount, 2, 'Should create new panel after dispose');
        });
    });

    suite('Message Handling - requestShaders', () => {
        test('should handle requestShaders message type', async () => {
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            sandbox.stub(vscode.workspace, 'findFiles').resolves([]);

            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'requestShaders', skipCache: false });

            assert.ok(postMessageSpy.calledOnce);
            const message = postMessageSpy.firstCall.args[0];
            assert.strictEqual(message.type, 'shadersUpdate');
        });

        test('should include savedState in response', async () => {
            const savedState = { sortBy: 'updated', pageSize: 50 };
            mockContext.workspaceState.get = sandbox.stub().returns(savedState);

            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            sandbox.stub(vscode.workspace, 'findFiles').resolves([]);

            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'requestShaders', skipCache: false });

            const message = postMessageSpy.firstCall.args[0];
            assert.deepStrictEqual(message.savedState, savedState);
        });

        test('should handle findFiles error gracefully', async () => {
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            sandbox.stub(vscode.workspace, 'findFiles').rejects(new Error('File system error'));

            const messageHandler = setupMessageHandler(mockPanel);

            // Should not throw
            await messageHandler({ type: 'requestShaders', skipCache: false });

            // Should still send response (even if empty)
            assert.ok(postMessageSpy.called);
        });

        test('should handle missing skipCache parameter', async () => {
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            sandbox.stub(vscode.workspace, 'findFiles').resolves([]);

            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'requestShaders' });

            assert.ok(postMessageSpy.calledOnce);
            const message = postMessageSpy.firstCall.args[0];
            assert.strictEqual(message.type, 'shadersUpdate');
        });
    });

    suite('Message Handling - requestShaderCode', () => {
        test('should send shader code on requestShaderCode message', async () => {
            const mockDocument = {
                getText: () => 'void main() { gl_FragColor = vec4(1.0); }'
            };
            sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
            sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns(null);

            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'requestShaderCode', path: '/test/shader.glsl' });

            assert.ok(postMessageSpy.calledOnce);
            const message = postMessageSpy.firstCall.args[0];
            assert.strictEqual(message.type, 'shaderCode');
            assert.strictEqual(message.path, '/test/shader.glsl');
            assert.strictEqual(message.code, 'void main() { gl_FragColor = vec4(1.0); }');
        });

        test('should include config and buffers in shader code response', async () => {
            const mockDocument = {
                getText: () => 'void main() {}'
            };
            const mockConfig = { resolution: [800, 600] };
            const mockBuffers = { bufferA: 'buffer code' };

            sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
            sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig')
                .callsFake((_path: any, buffers: any) => {
                    Object.assign(buffers, mockBuffers);
                    return mockConfig as any;
                });

            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'requestShaderCode', path: '/test/shader.glsl' });

            const message = postMessageSpy.firstCall.args[0];
            assert.deepStrictEqual(message.config, mockConfig);
            assert.deepStrictEqual(message.buffers, mockBuffers);
        });

        test('should handle missing path parameter', async () => {
            sandbox.stub(vscode.workspace, 'openTextDocument').rejects(new Error('No path'));
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

            const messageHandler = setupMessageHandler(mockPanel);

            // Should not throw
            await messageHandler({ type: 'requestShaderCode' });
            assert.ok(true, 'Should handle missing path gracefully');
        });
    });

    suite('Message Handling - saveThumbnail', () => {
        test('should handle saveThumbnail message without error', async () => {
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);

            // Should not throw
            await messageHandler({
                type: 'saveThumbnail',
                path: '/test/shader.glsl',
                thumbnail: 'data:image/png;base64,...',
                modifiedTime: 1000
            });

            assert.ok(true, 'Should handle saveThumbnail without error');
        });

        test('should handle saveThumbnail with missing modifiedTime', async () => {
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);

            await messageHandler({
                type: 'saveThumbnail',
                path: '/test/shader.glsl',
                thumbnail: 'data:image/png;base64,...'
            });

            assert.ok(true, 'Should handle missing modifiedTime');
        });
    });

    suite('Message Handling - openShader', () => {
        test('should open shader file on openShader message', async () => {
            const mockDocument = {} as any;
            const openTextDocumentStub = sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument);
            const showTextDocumentStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'openShader', path: '/test/shader.glsl' });

            assert.ok(openTextDocumentStub.calledOnce);
            assert.strictEqual(openTextDocumentStub.firstCall.args[0], '/test/shader.glsl');
            assert.ok(showTextDocumentStub.calledOnce);
            // Check that showTextDocument is called with correct viewColumn
            const callArgs = showTextDocumentStub.firstCall.args;
            // The second argument is the viewColumn
            // If mockPanel.viewColumn is undefined, should be ViewColumn.Beside
            assert.strictEqual(callArgs[1], vscode.ViewColumn.Beside);
        });

        test('should open shader in next column if panel has viewColumn', async () => {
            const mockDocument = {} as any;
            const openTextDocumentStub = sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument);
            const showTextDocumentStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

            // Simulate panel with a viewColumn
            mockPanel.viewColumn = vscode.ViewColumn.One;
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'openShader', path: '/test/shader.glsl' });

            assert.ok(openTextDocumentStub.calledOnce);
            assert.ok(showTextDocumentStub.calledOnce);
            const callArgs = showTextDocumentStub.firstCall.args;
            // Should be panel.viewColumn + 1
            assert.strictEqual(callArgs[1], mockPanel.viewColumn + 1);
        });

        test('should show error message if opening shader fails', async () => {
            sandbox.stub(vscode.workspace, 'openTextDocument').rejects(new Error('File not found'));
            const showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');

            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'openShader', path: '/test/shader.glsl' });

            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes('Failed to open shader'));
        });

        test('should handle missing path parameter', async () => {
            sandbox.stub(vscode.workspace, 'openTextDocument').rejects(new Error('No path'));
            const showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'openShader' });

            assert.ok(showErrorMessageStub.calledOnce, 'Should show error for missing path');
        });
    });

    suite('Message Handling - openConfig', () => {
        test('should open config file on openConfig message', async () => {
            const mockDocument = {} as any;
            const openTextDocumentStub = sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument);
            const showTextDocumentStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'openConfig', path: '/test/shader.sv.json' });

            assert.ok(openTextDocumentStub.calledOnce);
            assert.strictEqual(openTextDocumentStub.firstCall.args[0], '/test/shader.sv.json');
            assert.ok(showTextDocumentStub.calledOnce);
        });

        test('should show error message if opening config fails', async () => {
            sandbox.stub(vscode.workspace, 'openTextDocument').rejects(new Error('Config not found'));
            const showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');

            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'openConfig', path: '/test/shader.sv.json' });

            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes('Failed to open config'));
        });
    });

    suite('Message Handling - createConfig', () => {
        test('should create config and refresh shader list on createConfig message', async () => {
            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
            sandbox.stub(vscode.workspace, 'findFiles').resolves([]);

            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'createConfig', shaderPath: '/test/shader.glsl' });

            assert.ok(executeCommandStub.calledWith('shader-studio.generateConfig'));
        });

        test('should show error message if creating config fails', async () => {
            sandbox.stub(vscode.commands, 'executeCommand').rejects(new Error('Failed to generate'));
            const showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');

            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'createConfig', shaderPath: '/test/shader.glsl' });

            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes('Failed to create config'));
        });

        test('should handle missing shaderPath parameter', async () => {
            sandbox.stub(vscode.commands, 'executeCommand').rejects(new Error('No shader path'));
            const showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

            const messageHandler = setupMessageHandler(mockPanel);
            await messageHandler({ type: 'createConfig' });

            assert.ok(showErrorMessageStub.calledOnce, 'Should show error for missing shaderPath');
        });
    });

    suite('Message Handling - saveState', () => {
        test('should save state to workspace storage on saveState message', async () => {
            const updateStub = mockContext.workspaceState.update as sinon.SinonStub;

            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);

            const testState = { sortBy: 'name', pageSize: 30 };
            await messageHandler({ type: 'saveState', state: testState });

            assert.ok(updateStub.calledWith('shaderBrowser.state', testState));
        });

        test('should handle null state', async () => {
            const updateStub = mockContext.workspaceState.update as sinon.SinonStub;
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);

            await messageHandler({ type: 'saveState', state: null });

            assert.ok(updateStub.calledWith('shaderBrowser.state', null));
        });
    });

    suite('Message Handling - Edge Cases', () => {
        test('should ignore unknown message types', async () => {
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);

            // Should not throw
            await messageHandler({ type: 'unknownMessageType', data: 'test' });
            assert.ok(true, 'Should handle unknown message types gracefully');
        });

        test('should handle message with null type', async () => {
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);

            // Should not throw
            await messageHandler({ type: null });
            assert.ok(true, 'Should handle null message type');
        });

        test('should handle message with undefined type', async () => {
            sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
            const messageHandler = setupMessageHandler(mockPanel);

            // Should not throw
            await messageHandler({});
            assert.ok(true, 'Should handle undefined message type');
        });
    });
});
