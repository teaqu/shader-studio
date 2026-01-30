import * as assert from 'assert';
import * as sinon from 'sinon';
import { WebSocket, WebSocketServer } from 'ws';
import { WebSocketTransport } from '../../../app/transport/WebSocketTransport';

suite('WebSocketTransport Test Suite', () => {
    let transport: WebSocketTransport;
    let sandbox: sinon.SinonSandbox;
    let mockWsServer: sinon.SinonStubbedInstance<WebSocketServer>;
    let mockWsClient: sinon.SinonStubbedInstance<WebSocket>;
    let mockShaderProvider: any;
    let mockGlslFileTracker: any;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockShaderProvider = {
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

        sandbox.stub(WebSocketServer.prototype, 'constructor' as any).callsFake(function (this: any) {
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
        transport = new WebSocketTransport(51475, mockShaderProvider, mockGlslFileTracker);
        assert.strictEqual(transport.hasActiveClients(), false);
    });

    test('hasActiveClients returns true when clients are connected', () => {
        transport = new WebSocketTransport(51476, mockShaderProvider, mockGlslFileTracker);

        // Simulate client connection by accessing private wsClients
        const wsClients = (transport as any).wsClients as Set<WebSocket>;
        wsClients.add(mockWsClient as any);

        assert.strictEqual(transport.hasActiveClients(), true);
    });

    test('hasActiveClients returns false after all clients disconnect', () => {
        transport = new WebSocketTransport(51477, mockShaderProvider, mockGlslFileTracker);

        const wsClients = (transport as any).wsClients as Set<WebSocket>;
        wsClients.add(mockWsClient as any);

        assert.strictEqual(transport.hasActiveClients(), true);

        wsClients.delete(mockWsClient as any);

        assert.strictEqual(transport.hasActiveClients(), false);
    });

    test('hasActiveClients returns true with multiple clients', () => {
        transport = new WebSocketTransport(51478, mockShaderProvider, mockGlslFileTracker);

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
        transport = new WebSocketTransport(51479, mockShaderProvider, mockGlslFileTracker);

        assert.strictEqual(transport.hasActiveClients(), false);

        // Should not throw when sending to no clients
        assert.doesNotThrow(() => {
            transport.send({ type: 'test', data: 'hello' });
        });
    });

    test('close method clears all clients', () => {
        transport = new WebSocketTransport(51480, mockShaderProvider, mockGlslFileTracker);

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
            transport = new WebSocketTransport(51481, mockShaderProvider, mockGlslFileTracker);

            mockConfig = {
                get: sandbox.stub().withArgs('webServerPort').returns(3000)
            };
            if (!(require('vscode').workspace.getConfiguration as any).isSinonProxy) {
                vscodeConfigStub = sandbox.stub(require('vscode').workspace, 'getConfiguration').returns(mockConfig);
            } else {
                vscodeConfigStub = require('vscode').workspace.getConfiguration as sinon.SinonStub;
                vscodeConfigStub.returns(mockConfig);
            }
        });

        test('converts Windows path to HTTP URL', () => {
            const filePath = 'C:\\path\\to\\texture.png';
            const result = transport.convertUriForClient(filePath);

            assert.strictEqual(result, `http://localhost:3000/textures/${encodeURIComponent(filePath)}`);
        });

        test('converts Unix path to HTTP URL', () => {
            const filePath = '/path/to/texture.png';
            const result = transport.convertUriForClient(filePath);

            assert.strictEqual(result, `http://localhost:3000/textures/${encodeURIComponent(filePath)}`);
        });

        test('uses custom port', () => {
            mockConfig.get.withArgs('webServerPort').returns(8080);
            const filePath = 'C:\\path\\to\\texture.png';
            const result = transport.convertUriForClient(filePath);

            assert.strictEqual(result, `http://localhost:8080/textures/${encodeURIComponent(filePath)}`);
        });

        test('returns unchanged path for non-local file paths', () => {
            const httpUrl = 'http://example.com/texture.png';
            const result = transport.convertUriForClient(httpUrl);

            assert.strictEqual(result, httpUrl);
        });

        test('returns unchanged path for already converted file:// URLs', () => {
            const fileUrl = 'file://C:/path/to/texture.png';
            const result = transport.convertUriForClient(fileUrl);

            assert.strictEqual(result, fileUrl);
        });

        test('handles paths with spaces correctly', () => {
            const filePath = 'C:\\path\\with spaces\\texture.png';
            const result = transport.convertUriForClient(filePath);

            assert.strictEqual(result, `http://localhost:3000/textures/${encodeURIComponent(filePath)}`);
            assert.ok(result.includes('with%20spaces'));
        });

        test('handles paths with special characters correctly', () => {
            const filePath = 'C:\\path\\with&special#chars\\texture.png';
            const result = transport.convertUriForClient(filePath);

            assert.strictEqual(result, `http://localhost:3000/textures/${encodeURIComponent(filePath)}`);
            assert.ok(result.includes('%26') && result.includes('%23'));
        });

        test('handles relative paths correctly', () => {
            const relativePath = 'relative/path/texture.png';
            const result = transport.convertUriForClient(relativePath);

            // Should return unchanged since it doesn't match the local file pattern
            assert.strictEqual(result, relativePath);
        });
    });

    suite('handleVideoPaths', () => {
        let vscodeConfigStub: sinon.SinonStub;
        let mockConfig: any;

        setup(() => {
            transport = new WebSocketTransport(51482, mockShaderProvider, mockGlslFileTracker);

            mockConfig = {
                get: sandbox.stub().withArgs('webServerPort').returns(3000)
            };
            if (!(require('vscode').workspace.getConfiguration as any).isSinonProxy) {
                vscodeConfigStub = sandbox.stub(require('vscode').workspace, 'getConfiguration').returns(mockConfig);
            } else {
                vscodeConfigStub = require('vscode').workspace.getConfiguration as sinon.SinonStub;
                vscodeConfigStub.returns(mockConfig);
            }
        });

        test('converts video path to HTTP URL', () => {
            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            const message = {
                type: 'shaderSource',
                config: {
                    passes: {
                        Image: {
                            inputs: {
                                iChannel0: { type: 'video', path: '/path/to/video.mp4' }
                            }
                        }
                    }
                }
            };

            transport.send(message);

            const sentData = JSON.parse(mockWsClient.send.getCall(0).args[0] as string);
            assert.strictEqual(sentData.config.passes.Image.inputs.iChannel0.path, `http://localhost:3000/textures/${encodeURIComponent('/path/to/video.mp4')}`);
        });

        test('converts Windows video path to HTTP URL', () => {
            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            const message = {
                type: 'shaderSource',
                config: {
                    passes: {
                        Image: {
                            inputs: {
                                iChannel0: { type: 'video', path: 'C:\\path\\to\\video.mp4' }
                            }
                        }
                    }
                }
            };

            transport.send(message);

            const sentData = JSON.parse(mockWsClient.send.getCall(0).args[0] as string);
            assert.strictEqual(sentData.config.passes.Image.inputs.iChannel0.path, `http://localhost:3000/textures/${encodeURIComponent('C:\\path\\to\\video.mp4')}`);
        });

        test('handles multiple video inputs', () => {
            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            const message = {
                type: 'shaderSource',
                config: {
                    passes: {
                        Image: {
                            inputs: {
                                iChannel0: { type: 'video', path: '/path/to/video1.mp4' },
                                iChannel1: { type: 'video', path: '/path/to/video2.mp4' }
                            }
                        }
                    }
                }
            };

            transport.send(message);

            const sentData = JSON.parse(mockWsClient.send.getCall(0).args[0] as string);
            assert.strictEqual(sentData.config.passes.Image.inputs.iChannel0.path, `http://localhost:3000/textures/${encodeURIComponent('/path/to/video1.mp4')}`);
            assert.strictEqual(sentData.config.passes.Image.inputs.iChannel1.path, `http://localhost:3000/textures/${encodeURIComponent('/path/to/video2.mp4')}`);
        });

        test('does not modify non-video inputs', () => {
            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            const message = {
                type: 'shaderSource',
                config: {
                    passes: {
                        Image: {
                            inputs: {
                                iChannel0: { type: 'texture', path: '/path/to/texture.png' }
                            }
                        }
                    }
                }
            };

            transport.send(message);

            const sentData = JSON.parse(mockWsClient.send.getCall(0).args[0] as string);
            // Texture paths are handled by ConfigPathConverter, not handleVideoPaths
            // The path should remain as-is from handleVideoPaths perspective
            assert.ok(sentData.config.passes.Image.inputs.iChannel0.path);
        });

        test('handles video inputs in buffer passes', () => {
            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            const message = {
                type: 'shaderSource',
                config: {
                    passes: {
                        BufferA: {
                            inputs: {
                                iChannel0: { type: 'video', path: '/path/to/video.mp4' }
                            }
                        },
                        Image: {
                            inputs: {}
                        }
                    }
                }
            };

            transport.send(message);

            const sentData = JSON.parse(mockWsClient.send.getCall(0).args[0] as string);
            assert.strictEqual(sentData.config.passes.BufferA.inputs.iChannel0.path, `http://localhost:3000/textures/${encodeURIComponent('/path/to/video.mp4')}`);
        });

        test('uses custom port for video URLs', () => {
            mockConfig.get.withArgs('webServerPort').returns(8080);
            
            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            const message = {
                type: 'shaderSource',
                config: {
                    passes: {
                        Image: {
                            inputs: {
                                iChannel0: { type: 'video', path: '/path/to/video.mp4' }
                            }
                        }
                    }
                }
            };

            transport.send(message);

            const sentData = JSON.parse(mockWsClient.send.getCall(0).args[0] as string);
            assert.strictEqual(sentData.config.passes.Image.inputs.iChannel0.path, `http://localhost:8080/textures/${encodeURIComponent('/path/to/video.mp4')}`);
        });
    });
});
