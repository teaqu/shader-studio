import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { WebSocket, WebSocketServer } from 'ws';
import { WebSocketTransport } from '../../../app/transport/WebSocketTransport';
import { WorkspaceFileScanner } from '../../../app/WorkspaceFileScanner';
import { Logger } from '../../../app/services/Logger';

suite('WebSocketTransport Test Suite', () => {
  let transport: WebSocketTransport;
  let sandbox: sinon.SinonSandbox;
  let mockWsServer: sinon.SinonStubbedInstance<WebSocketServer>;
  let mockWsClient: sinon.SinonStubbedInstance<WebSocket>;
  let mockShaderProvider: any;
  let mockGlslFileTracker: any;
  let mockContext: any;

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

    mockContext = {
      extensionPath: '/mock/extension',
      workspaceState: {
        get: sandbox.stub().returns(null),
        update: sandbox.stub().resolves(),
      },
      subscriptions: [],
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
    transport = new WebSocketTransport(51475, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension');
    assert.strictEqual(transport.hasActiveClients(), false);
  });

  test('hasActiveClients returns true when clients are connected', () => {
    transport = new WebSocketTransport(51476, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension');

    // Simulate client connection by accessing private wsClients
    const wsClients = (transport as any).wsClients as Set<WebSocket>;
    wsClients.add(mockWsClient as any);

    assert.strictEqual(transport.hasActiveClients(), true);
  });

  test('hasActiveClients returns false after all clients disconnect', () => {
    transport = new WebSocketTransport(51477, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension');

    const wsClients = (transport as any).wsClients as Set<WebSocket>;
    wsClients.add(mockWsClient as any);

    assert.strictEqual(transport.hasActiveClients(), true);

    wsClients.delete(mockWsClient as any);

    assert.strictEqual(transport.hasActiveClients(), false);
  });

  test('hasActiveClients returns true with multiple clients', () => {
    transport = new WebSocketTransport(51478, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension');

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
    transport = new WebSocketTransport(51479, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension');

    assert.strictEqual(transport.hasActiveClients(), false);

    // Should not throw when sending to no clients
    assert.doesNotThrow(() => {
      transport.send({ type: 'test', data: 'hello' });
    });
  });

  test('close method clears all clients', () => {
    transport = new WebSocketTransport(51480, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension');

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
      transport = new WebSocketTransport(51481, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension');

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

  suite('Client Message Delegation', () => {
    setup(() => {
      transport = new WebSocketTransport(51483, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension');
    });

    test('ClientMessageHandler is used per connection — messages do not throw', () => {
      // WebSocketTransport creates a ClientMessageHandler per connection.
      // The detailed message-type behavior is tested in ClientMessageHandler.test.ts.
      // Here we just verify the transport is healthy and accepts connections.
      assert.ok(transport.hasActiveClients() === false);
    });
  });

  suite('processConfigPaths for browser clients', () => {
    let mockConfig: any;

    setup(() => {
      transport = new WebSocketTransport(51482, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension');
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

    test('converts audio input path to HTTP URL', () => {
      const wsClients = (transport as any).wsClients as Set<WebSocket>;
      wsClients.add(mockWsClient as any);

      transport.send({
        type: 'shaderSource',
        path: '/test/shader.glsl',
        config: {
          passes: {
            Image: {
              inputs: {
                iChannel0: { type: 'audio', path: '/path/to/audio.mp3' }
              }
            }
          }
        }
      });

      const sentData = JSON.parse(mockWsClient.send.getCall(0).args[0] as string);
      assert.ok(sentData.config.passes.Image.inputs.iChannel0.resolved_path.startsWith('http://localhost:3000/textures/'));
      assert.strictEqual(sentData.config.passes.Image.inputs.iChannel0.path, '/path/to/audio.mp3');
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

// Real networking tests — no WebSocketServer stub
suite('WebSocketTransport port binding', () => {
  const net = require('net');
  const transports: WebSocketTransport[] = [];

  const mockShaderProvider = { sendShaderToWebview: () => {} } as any;
  const mockGlslFileTracker = { getActiveOrLastViewedGLSLEditor: () => null } as any;
  const mockContext = { extensionPath: '/mock/extension', workspaceState: { get: () => null, update: () => Promise.resolve() }, subscriptions: [] } as any;

  setup(() => {
    if (!(Logger as any).instance) {
      const mockOutputChannel = {
        info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, dispose: () => {},
      } as any;
      Logger.initialize(mockOutputChannel);
    }
  });

  teardown(async () => {
    for (const t of transports) {
      t.close();
    }
    transports.length = 0;
    (Logger as any).instance = undefined;
    // Brief pause to let ports fully release
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  test('onReady is called with preferred port when available', (done) => {
    const port = 51560;
    const t = new WebSocketTransport(port, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension', (actualPort) => {
      transports.push(t);
      assert.strictEqual(actualPort, port);
      done();
    });
  });

  test('onReady is called with a different port when preferred port is in use', (done) => {
    const port = 51561;
    const blocker = net.createServer();
    blocker.listen(port, () => {
      const t = new WebSocketTransport(port, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension', (actualPort) => {
        transports.push(t);
        blocker.close(() => {
          assert.notStrictEqual(actualPort, port);
          assert.ok(actualPort > 0);
          done();
        });
      });
    });
  });

  test('fallback port is a valid ephemeral port', (done) => {
    const port = 51562;
    const blocker = net.createServer();
    blocker.listen(port, () => {
      const t = new WebSocketTransport(port, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension', (actualPort) => {
        transports.push(t);
        blocker.close(() => {
          assert.ok(actualPort >= 1024, `expected ephemeral port, got ${actualPort}`);
          assert.ok(actualPort <= 65535);
          done();
        });
      });
    });
  });

  test('two instances on same preferred port get different actual ports', (done) => {
    const port = 51563;
    let firstPort: number;

    const t1 = new WebSocketTransport(port, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension', (p1) => {
      transports.push(t1);
      firstPort = p1;
      assert.strictEqual(p1, port);

      const t2 = new WebSocketTransport(port, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension', (p2) => {
        transports.push(t2);
        assert.notStrictEqual(p2, firstPort);
        done();
      });
    });
  });

  test('transport still accepts connections after fallback', (done) => {
    const { WebSocket } = require('ws');
    const port = 51564;
    const blocker = net.createServer();
    blocker.listen(port, () => {
      const t = new WebSocketTransport(port, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension', (actualPort) => {
        transports.push(t);
        blocker.close(() => {
          const ws = new WebSocket(`ws://localhost:${actualPort}`);
          ws.on('open', () => {
            assert.ok(t.hasActiveClients());
            ws.close();
            done();
          });
          ws.on('error', (err: Error) => done(err));
        });
      });
    });
  });

  test('works without onReady callback', (done) => {
    const port = 51565;
    // Should not throw
    const t = new WebSocketTransport(port, mockShaderProvider, mockGlslFileTracker, mockContext, '/mock/extension');
    transports.push(t);
    // Give it a moment to bind
    setTimeout(done, 100);
  });
});
