import * as assert from 'assert';
import * as sinon from 'sinon';
import { WebSocket, WebSocketServer } from 'ws';
import { WebSocketTransport } from '../../../app/transport/WebSocketTransport';

suite('WebSocketTransport Test Suite', () => {
    let transport: WebSocketTransport;
    let sandbox: sinon.SinonSandbox;
    let mockWsServer: sinon.SinonStubbedInstance<WebSocketServer>;
    let mockWsClient: sinon.SinonStubbedInstance<WebSocket>;
    let mockShaderProcessor: any;
    let mockGlslFileTracker: any;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockShaderProcessor = {
            sendShaderToWebview: sandbox.stub()
        };

        mockGlslFileTracker = {
            getActiveOrLastViewedGLSLEditor: sandbox.stub().returns(null),
            isGlslEditor: sandbox.stub().returns(false),
            setLastViewedGlslFile: sandbox.stub(),
            getLastViewedGlslFile: sandbox.stub().returns(null)
        } as any;

        mockWsServer = {
            on: sandbox.stub(),
            close: sandbox.stub(),
            emit: sandbox.stub(),
            addListener: sandbox.stub(),
            removeListener: sandbox.stub(),
            removeAllListeners: sandbox.stub(),
            setMaxListeners: sandbox.stub(),
            getMaxListeners: sandbox.stub(),
            listeners: sandbox.stub(),
            rawListeners: sandbox.stub(),
            listenerCount: sandbox.stub(),
            prependListener: sandbox.stub(),
            prependOnceListener: sandbox.stub(),
            eventNames: sandbox.stub(),
            off: sandbox.stub(),
            once: sandbox.stub(),
        } as any;

        mockWsClient = {
            readyState: WebSocket.OPEN,
            on: sandbox.stub(),
            send: sandbox.stub(),
            close: sandbox.stub(),
            ping: sandbox.stub(),
            terminate: sandbox.stub(),
        } as any;

        sandbox.stub(WebSocketServer.prototype, 'constructor' as any).callsFake(function(this: any) {
            Object.assign(this, mockWsServer);
            return this;
        });
    });

    teardown(() => {
        if (transport) {
            transport.close();
        }
        sandbox.restore();
    });

    test('hasActiveClients returns false when no clients connected', () => {
        transport = new WebSocketTransport(51475, mockShaderProcessor, mockGlslFileTracker);
        assert.strictEqual(transport.hasActiveClients(), false);
    });

    test('hasActiveClients returns true when clients are connected', () => {
        transport = new WebSocketTransport(51476, mockShaderProcessor, mockGlslFileTracker);
        
        // Simulate client connection by accessing private wsClients
        const wsClients = (transport as any).wsClients as Set<WebSocket>;
        wsClients.add(mockWsClient as any);
        
        assert.strictEqual(transport.hasActiveClients(), true);
    });

    test('hasActiveClients returns false after all clients disconnect', () => {
        transport = new WebSocketTransport(51477, mockShaderProcessor, mockGlslFileTracker);
        
        const wsClients = (transport as any).wsClients as Set<WebSocket>;
        wsClients.add(mockWsClient as any);
        
        assert.strictEqual(transport.hasActiveClients(), true);
        
        wsClients.delete(mockWsClient as any);
        
        assert.strictEqual(transport.hasActiveClients(), false);
    });

    test('hasActiveClients returns true with multiple clients', () => {
        transport = new WebSocketTransport(51478, mockShaderProcessor, mockGlslFileTracker);
        
        const wsClients = (transport as any).wsClients as Set<WebSocket>;
        const mockClient2 = { ...mockWsClient } as any;
        
        wsClients.add(mockWsClient as any);
        wsClients.add(mockClient2);
        
        assert.strictEqual(transport.hasActiveClients(), true);
        
        wsClients.delete(mockWsClient as any);
        assert.strictEqual(transport.hasActiveClients(), true);
        
        wsClients.delete(mockClient2);
        assert.strictEqual(transport.hasActiveClients(), false);
    });

    test('send method handles no clients gracefully', () => {
        transport = new WebSocketTransport(51479, mockShaderProcessor, mockGlslFileTracker);
        
        assert.strictEqual(transport.hasActiveClients(), false);
        
        // Should not throw when sending to no clients
        assert.doesNotThrow(() => {
            transport.send({ type: 'test', data: 'hello' });
        });
    });

    test('close method clears all clients', () => {
        transport = new WebSocketTransport(51480, mockShaderProcessor, mockGlslFileTracker);
        
        const wsClients = (transport as any).wsClients as Set<WebSocket>;
        wsClients.add(mockWsClient as any);
        
        assert.strictEqual(transport.hasActiveClients(), true);
        
        transport.close();
        
        assert.strictEqual(transport.hasActiveClients(), false);
    });

    suite('convertUriForClient', () => {
        let vscodeConfigStub: sinon.SinonStub;
        let mockConfig: any;

        setup(() => {
            transport = new WebSocketTransport(51481, mockShaderProcessor, mockGlslFileTracker);
            
            mockConfig = {
                get: sandbox.stub().withArgs('webServerPort').returns(3000)
            };
            vscodeConfigStub = sandbox.stub(require('vscode').workspace, 'getConfiguration').returns(mockConfig);
        });

        test('converts Windows path to file:// URL for Electron client', () => {
            const filePath = 'C:\\path\\to\\texture.png';
            const result = transport.convertUriForClient(filePath, 'electron');
            
            assert.strictEqual(result, 'file://C:/path/to/texture.png');
        });

        test('converts Unix path to file:// URL for Electron client', () => {
            const filePath = '/path/to/texture.png';
            const result = transport.convertUriForClient(filePath, 'electron');
            
            assert.strictEqual(result, 'file:///path/to/texture.png');
        });

        test('converts Windows path to HTTP URL for browser client', () => {
            const filePath = 'C:\\path\\to\\texture.png';
            const result = transport.convertUriForClient(filePath, 'browser');
            
            assert.strictEqual(result, `http://localhost:3000/textures/${encodeURIComponent(filePath)}`);
        });

        test('converts Unix path to HTTP URL for browser client', () => {
            const filePath = '/path/to/texture.png';
            const result = transport.convertUriForClient(filePath, 'browser');
            
            assert.strictEqual(result, `http://localhost:3000/textures/${encodeURIComponent(filePath)}`);
        });

        test('uses custom port for browser client', () => {
            mockConfig.get.withArgs('webServerPort').returns(8080);
            const filePath = 'C:\\path\\to\\texture.png';
            const result = transport.convertUriForClient(filePath, 'browser');
            
            assert.strictEqual(result, `http://localhost:8080/textures/${encodeURIComponent(filePath)}`);
        });

        test('defaults to browser client type when not specified', () => {
            const filePath = 'C:\\path\\to\\texture.png';
            const result = transport.convertUriForClient(filePath);
            
            assert.strictEqual(result, `http://localhost:3000/textures/${encodeURIComponent(filePath)}`);
        });

        test('returns unchanged path for non-local file paths', () => {
            const httpUrl = 'http://example.com/texture.png';
            const result = transport.convertUriForClient(httpUrl, 'browser');
            
            assert.strictEqual(result, httpUrl);
        });

        test('returns unchanged path for already converted file:// URLs', () => {
            const fileUrl = 'file://C:/path/to/texture.png';
            const result = transport.convertUriForClient(fileUrl, 'electron');
            
            assert.strictEqual(result, fileUrl);
        });

        test('handles paths with spaces correctly for browser client', () => {
            const filePath = 'C:\\path\\with spaces\\texture.png';
            const result = transport.convertUriForClient(filePath, 'browser');
            
            assert.strictEqual(result, `http://localhost:3000/textures/${encodeURIComponent(filePath)}`);
            assert.ok(result.includes('with%20spaces'));
        });

        test('handles paths with special characters correctly for browser client', () => {
            const filePath = 'C:\\path\\with&special#chars\\texture.png';
            const result = transport.convertUriForClient(filePath, 'browser');
            
            assert.strictEqual(result, `http://localhost:3000/textures/${encodeURIComponent(filePath)}`);
            assert.ok(result.includes('%26') && result.includes('%23'));
        });

        test('handles relative paths correctly', () => {
            const relativePath = 'relative/path/texture.png';
            const result = transport.convertUriForClient(relativePath, 'browser');
            
            // Should return unchanged since it doesn't match the local file pattern
            assert.strictEqual(result, relativePath);
        });
    });
});
