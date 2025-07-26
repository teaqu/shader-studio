import * as assert from 'assert';
import * as sinon from 'sinon';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WebServer } from '../../app/WebServer';

suite('WebServer Test Suite', () => {
    let webServer: WebServer;
    let sandbox: sinon.SinonSandbox;
    let mockContext: sinon.SinonStubbedInstance<vscode.ExtensionContext>;
    let mockLogger: any;
    let mockStatusBar: any;
    let mockWorkspaceConfig: any;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock vscode context
        mockContext = {
            extensionUri: vscode.Uri.file('/mock/extension/path'),
            subscriptions: []
        } as any;

        // Mock workspace configuration
        mockWorkspaceConfig = {
            get: sandbox.stub().withArgs('webServerPort').returns(3000)
        };
        sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockWorkspaceConfig);

        // Mock Logger static method
        mockLogger = {
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub()
        };
        sandbox.stub(require('../../app/services/Logger').Logger, 'getInstance').returns(mockLogger);

        // Mock vscode.window.createStatusBarItem
        const mockStatusBarItem = {
            show: sandbox.stub(),
            hide: sandbox.stub(),
            text: '',
            tooltip: '',
            command: ''
        };
        sandbox.stub(vscode.window, 'createStatusBarItem').returns(mockStatusBarItem as any);

        // Mock Uri.joinPath
        sandbox.stub(vscode.Uri, 'joinPath').callsFake((base, ...segments) => {
            return { fsPath: path.join('/mock/path', ...segments) } as vscode.Uri;
        });
    });

    teardown(() => {
        if (webServer && webServer.isRunning()) {
            webServer.stopWebServer();
        }
        sandbox.restore();
    });

    suite('Texture Request Handling', () => {
        let mockRequest: sinon.SinonStubbedInstance<http.IncomingMessage>;
        let mockResponse: sinon.SinonStubbedInstance<http.ServerResponse>;

        setup(() => {
            webServer = new WebServer(mockContext);
            
            mockRequest = {
                url: '',
                method: 'GET'
            } as any;

            mockResponse = {
                writeHead: sandbox.stub(),
                end: sandbox.stub(),
                setHeader: sandbox.stub()
            } as any;
        });

        test('handles missing URL with 400 error', () => {
            mockRequest.url = undefined;

            (webServer as any).handleTextureRequest(mockRequest, mockResponse);

            assert.ok(mockResponse.writeHead.calledWith(400));
            assert.ok(mockResponse.end.calledWith('Bad Request'));
        });

        test('handles non-existent texture file with 404 error', () => {
            const texturePath = 'C:\\nonexistent\\path\\texture.png';
            mockRequest.url = `/textures/${encodeURIComponent(texturePath)}`;

            (webServer as any).handleTextureRequest(mockRequest, mockResponse);

            assert.ok(mockResponse.writeHead.calledWith(404));
            assert.ok(mockResponse.end.calledWith('Texture not found'));
        });

        test('properly decodes URL-encoded file paths', () => {
            const texturePath = 'C:\\path\\with spaces\\texture.png';
            mockRequest.url = `/textures/${encodeURIComponent(texturePath)}`;

            (webServer as any).handleTextureRequest(mockRequest, mockResponse);

            // Should attempt to check if file exists (which it won't in test environment)
            assert.ok(mockResponse.writeHead.calledWith(404));
            assert.ok(mockResponse.end.calledWith('Texture not found'));
        });

        test('properly handles special characters in paths', () => {
            const texturePath = 'C:\\path\\with&special#chars\\texture.png';
            mockRequest.url = `/textures/${encodeURIComponent(texturePath)}`;

            (webServer as any).handleTextureRequest(mockRequest, mockResponse);

            // Should attempt to check if file exists (which it won't in test environment)
            assert.ok(mockResponse.writeHead.calledWith(404));
            assert.ok(mockResponse.end.calledWith('Texture not found'));
        });
    });

    suite('Server Lifecycle', () => {
        test('getHttpUrl returns correct URL', () => {
            webServer = new WebServer(mockContext);
            
            const url = webServer.getHttpUrl();
            
            assert.strictEqual(url, 'http://localhost:3000');
        });

        test('getHttpUrl uses configured port', () => {
            mockWorkspaceConfig.get.withArgs('webServerPort').returns(8080);
            webServer = new WebServer(mockContext);
            
            const url = webServer.getHttpUrl();
            
            assert.strictEqual(url, 'http://localhost:8080');
        });

        test('isRunning returns false initially', () => {
            webServer = new WebServer(mockContext);
            
            assert.strictEqual(webServer.isRunning(), false);
        });
    });
});
