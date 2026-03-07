import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { WebSocket, WebSocketServer } from 'ws';
import { WebSocketTransport } from '../../../app/transport/WebSocketTransport';
import { WorkspaceFileScanner } from '../../../app/WorkspaceFileScanner';

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

        test('converts file:// URLs to HTTP texture URLs', () => {
            const fileUrl = 'file://C:/path/to/texture.png';
            const result = transport.convertUriForClient(fileUrl);

            assert.strictEqual(result, `http://localhost:3000/textures/${encodeURIComponent('C:/path/to/texture.png')}`);
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

    suite('Client Request Handling', () => {
        let vscodeConfigStub: sinon.SinonStub;
        let mockConfig: any;

        setup(() => {
            transport = new WebSocketTransport(51483, mockShaderProvider, mockGlslFileTracker);

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

        test('requestWorkspaceFiles returns files via WebSocket', async () => {
            const mockFiles = [
                { name: 'texture.png', workspacePath: '@/textures/texture.png', thumbnailUri: 'http://localhost:3000/textures/test', isSameDirectory: true },
            ];
            const scanStub = sandbox.stub(WorkspaceFileScanner, 'scanFiles').resolves(mockFiles);

            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            await (transport as any).handleClientRequest(
                { type: 'requestWorkspaceFiles', payload: { extensions: ['png', 'jpg'], shaderPath: '/test/shader.glsl' } },
                mockWsClient,
            );

            assert.ok(scanStub.calledOnce);
            assert.deepStrictEqual(scanStub.firstCall.args[0], ['png', 'jpg']);
            assert.strictEqual(scanStub.firstCall.args[1], '/test/shader.glsl');
            assert.strictEqual(typeof scanStub.firstCall.args[2], 'function');

            assert.ok(mockWsClient.send.calledOnce);
            const response = JSON.parse(mockWsClient.send.firstCall.args[0] as string);
            assert.strictEqual(response.type, 'workspaceFiles');
            assert.strictEqual(response.payload.files.length, 1);
            assert.strictEqual(response.payload.files[0].name, 'texture.png');
        });

        test('requestWorkspaceFiles uses HTTP URL converter', async () => {
            let capturedConverter: ((path: string) => string) | undefined;
            sandbox.stub(WorkspaceFileScanner, 'scanFiles').callsFake(async (_ext, _path, converter) => {
                capturedConverter = converter;
                return [];
            });

            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            await (transport as any).handleClientRequest(
                { type: 'requestWorkspaceFiles', payload: { extensions: ['png'], shaderPath: '/test/shader.glsl' } },
                mockWsClient,
            );

            assert.ok(capturedConverter);
            const result = capturedConverter!('/path/to/texture.png');
            assert.strictEqual(result, `http://localhost:3000/textures/${encodeURIComponent('/path/to/texture.png')}`);
        });

        test('requestWorkspaceFiles sends empty array on error', async () => {
            sandbox.stub(WorkspaceFileScanner, 'scanFiles').rejects(new Error('scan failed'));

            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            await (transport as any).handleClientRequest(
                { type: 'requestWorkspaceFiles', payload: { extensions: ['png'], shaderPath: '/test/shader.glsl' } },
                mockWsClient,
            );

            assert.ok(mockWsClient.send.calledOnce);
            const response = JSON.parse(mockWsClient.send.firstCall.args[0] as string);
            assert.strictEqual(response.type, 'workspaceFiles');
            assert.deepStrictEqual(response.payload.files, []);
        });

        test('updateConfig writes config and triggers shader refresh', async () => {
            const fsWriteStub = sandbox.stub(require('fs'), 'writeFileSync');
            mockShaderProvider.sendShaderFromPath = sandbox.stub();

            await (transport as any).handleClientRequest(
                {
                    type: 'updateConfig',
                    payload: {
                        config: { passes: {} },
                        text: '{"passes":{}}',
                        shaderPath: '/test/shader.glsl',
                    },
                },
                mockWsClient,
            );

            assert.ok(fsWriteStub.calledOnce);
            assert.strictEqual(fsWriteStub.firstCall.args[0], '/test/shader.sha.json');
            assert.strictEqual(fsWriteStub.firstCall.args[1], '{"passes":{}}');
        });

        test('createBufferFile creates file when it does not exist', async () => {
            const mockEditor = { document: { uri: { fsPath: '/test/shader.glsl' } } };
            mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns(mockEditor);

            const existsStub = sandbox.stub(require('fs'), 'existsSync').returns(false);
            const writeStub = sandbox.stub(require('fs'), 'writeFileSync');

            await (transport as any).handleClientRequest(
                {
                    type: 'createBufferFile',
                    payload: { bufferName: 'BufferA', filePath: 'bufferA.glsl' },
                },
                mockWsClient,
            );

            assert.ok(writeStub.called);
        });

        test('updateShaderSource delegates to overlay handler', async () => {
            const overlayHandler = (transport as any).overlayHandler;
            const handleStub = sandbox.stub(overlayHandler, 'handleUpdateShaderSource').resolves();

            await (transport as any).handleClientRequest(
                {
                    type: 'updateShaderSource',
                    payload: { code: 'void main() {}', path: '/test/shader.glsl' },
                },
                mockWsClient,
            );

            assert.ok(handleStub.calledOnce);
            assert.deepStrictEqual(handleStub.firstCall.args[0], { code: 'void main() {}', path: '/test/shader.glsl' });
        });

        test('requestFileContents sends file contents via WebSocket', async () => {
            const existsStub = sandbox.stub(require('fs'), 'existsSync').returns(true);
            const readStub = sandbox.stub(require('fs'), 'readFileSync');
            readStub.withArgs('/test/shader.sha.json', 'utf-8').returns('{"passes":{"BufferA":{"path":"bufferA.glsl"}}}');
            readStub.withArgs('/test/bufferA.glsl', 'utf-8').returns('// buffer code');

            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            await (transport as any).handleClientRequest(
                {
                    type: 'requestFileContents',
                    payload: { bufferName: 'BufferA', shaderPath: '/test/shader.glsl' },
                },
                mockWsClient,
            );

            assert.ok(mockWsClient.send.calledOnce);
            const response = JSON.parse(mockWsClient.send.firstCall.args[0] as string);
            assert.strictEqual(response.type, 'fileContents');
            assert.strictEqual(response.payload.code, '// buffer code');
            assert.strictEqual(response.payload.bufferName, 'BufferA');
        });

        test('CLIENT_REQUEST_TYPES includes all non-panel-specific message types', () => {
            const clientTypes = (WebSocketTransport as any).CLIENT_REQUEST_TYPES as Set<string>;

            // Messages that should be handled directly by WebSocketTransport
            assert.ok(clientTypes.has('requestWorkspaceFiles'), 'should handle requestWorkspaceFiles');
            assert.ok(clientTypes.has('updateConfig'), 'should handle updateConfig');
            assert.ok(clientTypes.has('createBufferFile'), 'should handle createBufferFile');
            assert.ok(clientTypes.has('updateShaderSource'), 'should handle updateShaderSource');
            assert.ok(clientTypes.has('requestFileContents'), 'should handle requestFileContents');
            assert.ok(clientTypes.has('requestLayout'), 'should handle requestLayout');

            // Panel-specific messages should NOT be in the set
            assert.ok(!clientTypes.has('navigateToBuffer'), 'navigateToBuffer is panel-specific');
            assert.ok(!clientTypes.has('forkShader'), 'forkShader is panel-specific');
            assert.ok(!clientTypes.has('extensionCommand'), 'extensionCommand is panel-specific');
        });

        test('requestLayout responds with restoreLayout and null payload', async () => {
            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            await (transport as any).handleClientRequest(
                { type: 'requestLayout' },
                mockWsClient,
            );

            assert.ok(mockWsClient.send.calledOnce);
            const response = JSON.parse(mockWsClient.send.firstCall.args[0] as string);
            assert.strictEqual(response.type, 'restoreLayout');
            assert.strictEqual(response.payload, null);
        });

        test('requestLayout does not send if client disconnected', async () => {
            const disconnectedClient = {
                ...mockWsClient,
                readyState: WebSocket.CLOSED,
                send: sandbox.stub(),
            } as any;

            await (transport as any).handleClientRequest(
                { type: 'requestLayout' },
                disconnectedClient,
            );

            assert.ok(disconnectedClient.send.notCalled);
        });
    });

    suite('processConfigPaths for browser clients', () => {
        let mockConfig: any;

        setup(() => {
            transport = new WebSocketTransport(51482, mockShaderProvider, mockGlslFileTracker);
            mockConfig = {
                get: sandbox.stub().withArgs('webServerPort').returns(3000)
            };
            if (!(require('vscode').workspace.getConfiguration as any).isSinonProxy) {
                sandbox.stub(require('vscode').workspace, 'getConfiguration').returns(mockConfig);
            } else {
                (require('vscode').workspace.getConfiguration as sinon.SinonStub).returns(mockConfig);
            }
        });

        test('converts video path to HTTP URL', () => {
            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            transport.send({
                type: 'shaderSource',
                path: '/test/shader.glsl',
                config: {
                    passes: {
                        Image: {
                            inputs: {
                                iChannel0: { type: 'video', path: '/path/to/video.mp4' }
                            }
                        }
                    }
                }
            });

            const sentData = JSON.parse(mockWsClient.send.getCall(0).args[0] as string);
            assert.strictEqual(
                sentData.config.passes.Image.inputs.iChannel0.path,
                `http://localhost:3000/textures/${encodeURIComponent('/path/to/video.mp4')}`
            );
            assert.ok(sentData.config.passes.Image.inputs.iChannel0.resolved_path.startsWith('http://localhost:3000/textures/'));
        });

        test('converts texture path to HTTP URL in resolved_path', () => {
            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            transport.send({
                type: 'shaderSource',
                path: '/test/shader.glsl',
                config: {
                    passes: {
                        Image: {
                            inputs: {
                                iChannel0: { type: 'texture', path: '/path/to/texture.png' }
                            }
                        }
                    }
                }
            });

            const sentData = JSON.parse(mockWsClient.send.getCall(0).args[0] as string);
            assert.ok(sentData.config.passes.Image.inputs.iChannel0.resolved_path.startsWith('http://localhost:3000/textures/'));
            assert.strictEqual(sentData.config.passes.Image.inputs.iChannel0.path, '/path/to/texture.png');
        });

        test('handles multiple inputs across passes', () => {
            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            transport.send({
                type: 'shaderSource',
                path: '/test/shader.glsl',
                config: {
                    passes: {
                        BufferA: {
                            inputs: {
                                iChannel0: { type: 'texture', path: '/path/to/noise.png' }
                            }
                        },
                        Image: {
                            inputs: {
                                iChannel0: { type: 'video', path: '/path/to/video.mp4' }
                            }
                        }
                    }
                }
            });

            const sentData = JSON.parse(mockWsClient.send.getCall(0).args[0] as string);
            assert.ok(sentData.config.passes.BufferA.inputs.iChannel0.resolved_path.startsWith('http://localhost:3000/textures/'));
            assert.ok(sentData.config.passes.Image.inputs.iChannel0.resolved_path.startsWith('http://localhost:3000/textures/'));
            assert.strictEqual(
                sentData.config.passes.Image.inputs.iChannel0.path,
                `http://localhost:3000/textures/${encodeURIComponent('/path/to/video.mp4')}`
            );
        });

        test('uses custom port for HTTP URLs', () => {
            mockConfig.get.withArgs('webServerPort').returns(8080);
            const wsClients = (transport as any).wsClients as Set<WebSocket>;
            wsClients.add(mockWsClient as any);

            transport.send({
                type: 'shaderSource',
                path: '/test/shader.glsl',
                config: {
                    passes: {
                        Image: {
                            inputs: {
                                iChannel0: { type: 'video', path: '/path/to/video.mp4' }
                            }
                        }
                    }
                }
            });

            const sentData = JSON.parse(mockWsClient.send.getCall(0).args[0] as string);
            assert.strictEqual(
                sentData.config.passes.Image.inputs.iChannel0.path,
                `http://localhost:8080/textures/${encodeURIComponent('/path/to/video.mp4')}`
            );
            assert.ok(sentData.config.passes.Image.inputs.iChannel0.resolved_path.startsWith('http://localhost:8080/textures/'));
        });
    });
});
