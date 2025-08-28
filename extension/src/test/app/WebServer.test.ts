import * as assert from 'assert';
import * as sinon from 'sinon';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';
import { WebServer } from '../../app/WebServer';
import { EventEmitter } from 'stream';
const proxyquire = require('proxyquire');

suite('WebServer Test Suite', () => {
    let webServer: WebServer;
    let sandbox: sinon.SinonSandbox;
    let mockContext: sinon.SinonStubbedInstance<vscode.ExtensionContext>;
    let mockLogger: any;
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
            get: sandbox.stub()
        };
        // Default returns
        mockWorkspaceConfig.get.withArgs('webServerPort').returns(3000);
        mockWorkspaceConfig.get.returns(51472); // Default for any unmatched key
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
            return { fsPath: path.join(base.fsPath, ...segments) } as vscode.Uri;
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

    suite('Development Mode', () => {
        test('devMode defaults to false when not specified', () => {
            webServer = new WebServer(mockContext); // devMode not specified

            const devMode = (webServer as any).devMode;

            assert.strictEqual(devMode, false, 'devMode should default to false');
        });

        test('devMode is set correctly when specified', () => {
            const devWebServer = new WebServer(mockContext, true);
            const prodWebServer = new WebServer(mockContext, false);

            const devMode = (devWebServer as any).devMode;
            const prodMode = (prodWebServer as any).devMode;

            assert.strictEqual(devMode, true, 'devMode should be true when specified');
            assert.strictEqual(prodMode, false, 'devMode should be false when specified');
        });

        test('path selection logic based on devMode', () => {
            const prodWebServer = new WebServer(mockContext, false);

            const prodDevMode = (prodWebServer as any).devMode;
            assert.strictEqual(prodDevMode, false, 'Production mode should use ui-dist');

            const devWebServer = new WebServer(mockContext, true);
            const devDevMode = (devWebServer as any).devMode;
            assert.strictEqual(devDevMode, true, 'Development mode should use ../ui');
        });
    });

    suite('WebSocket Port Injection', () => {
        let mockRequest: sinon.SinonStubbedInstance<http.IncomingMessage>;
        let mockResponse: sinon.SinonStubbedInstance<http.ServerResponse>;
        let mockHttpServer: EventEmitter;

        setup(() => {
            mockHttpServer = new EventEmitter();
            (mockHttpServer as any).listen = sandbox.stub();
            (mockHttpServer as any).close = sandbox.stub();

            let requestHandler: any;

            const { WebServer: ProxiedWebServer } = proxyquire('../../app/WebServer', {
                'fs': {
                    readFile: sandbox.stub().callsFake((filePath, callback) => {
                        callback(null, Buffer.from('<html><head></head><body></body></html>'));
                    }),
                    existsSync: sandbox.stub().returns(true)
                },
                'http': {
                    createServer: sandbox.stub().callsFake((handler) => {
                        requestHandler = handler;
                        // Forward request events to the handler
                        mockHttpServer.on('request', requestHandler);
                        return mockHttpServer;
                    })
                }
            });
            webServer = new ProxiedWebServer(mockContext);
            webServer.startWebServer();

            mockRequest = { url: '/index.html', method: 'GET' } as any;
            mockResponse = { writeHead: sandbox.stub(), end: sandbox.stub(), setHeader: sandbox.stub() } as any;
        });

        test('should inject configured WebSocket port into index.html', () => {
            const testPort = 9999;
            mockWorkspaceConfig.get.withArgs('webSocketPort').returns(testPort);

            // When: The server receives a request for index.html
            mockHttpServer.emit('request', mockRequest, mockResponse);

            if (mockResponse.end.called) {
                // Then: The response should contain the correct script
                const responseBody = mockResponse.end.getCall(0).args[0];
                const responseString = Buffer.isBuffer(responseBody) ? responseBody.toString() : responseBody;
                const expectedScript = `<script>window.shaderViewConfig = { port: ${testPort} };</script>`;
                assert.ok(responseString.includes(expectedScript), `HTML should contain the configured port script.`);
            } else {
                assert.fail('response.end was never called');
            }
        });

        test('should inject default WebSocket port when not configured', () => {
            mockWorkspaceConfig.get.withArgs('webSocketPort').returns(undefined);

            // When: The server receives a request for index.html
            mockHttpServer.emit('request', mockRequest, mockResponse);

            // Then: The response should contain the default port script
            const responseBody = mockResponse.end.getCall(0).args[0];
            const responseString = Buffer.isBuffer(responseBody) ? responseBody.toString() : responseBody;
            const expectedScript = `<script>window.shaderViewConfig = { port: 51472 };</script>`;
            assert.ok(responseString.includes(expectedScript), `HTML should contain the default port script. Got: ${responseString}`);
        });
    });
});
