import * as assert from 'assert';
import * as sinon from 'sinon';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  WebServer,
  collectTextureRoots,
  getTextureCorsHeaders,
  openRegularFile,
  parseRange,
  resolveSafeTexturePath,
  resolveSafeUiAsset,
} from '../../app/WebServer';
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
        method: 'GET',
        headers: {},
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

    test('rejects texture files outside workspace roots', () => {
      const texturePath = 'C:\\nonexistent\\path\\texture.png';
      mockRequest.url = `/textures/${encodeURIComponent(texturePath)}`;

      (webServer as any).handleTextureRequest(mockRequest, mockResponse);

      assert.ok(mockResponse.writeHead.calledWith(403));
      assert.ok(mockResponse.end.calledWith('Invalid texture path'));
    });

    test('rejects URL-encoded paths outside workspace roots', () => {
      const texturePath = 'C:\\path\\with spaces\\texture.png';
      mockRequest.url = `/textures/${encodeURIComponent(texturePath)}`;

      (webServer as any).handleTextureRequest(mockRequest, mockResponse);

      assert.ok(mockResponse.writeHead.calledWith(403));
      assert.ok(mockResponse.end.calledWith('Invalid texture path'));
    });

    test('rejects special-character paths outside workspace roots', () => {
      const texturePath = 'C:\\path\\with&special#chars\\texture.png';
      mockRequest.url = `/textures/${encodeURIComponent(texturePath)}`;

      (webServer as any).handleTextureRequest(mockRequest, mockResponse);

      assert.ok(mockResponse.writeHead.calledWith(403));
      assert.ok(mockResponse.end.calledWith('Invalid texture path'));
    });
  });

  suite('Texture path authorization', () => {
    let fixtureRoot!: string;
    let outsideRoot!: string;

    setup(() => {
      fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-studio-texture-root-'));
      outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-studio-texture-outside-'));
      fs.writeFileSync(path.join(fixtureRoot, 'texture.png'), 'image');
      fs.writeFileSync(path.join(outsideRoot, 'secret.png'), 'secret');
      fs.symlinkSync(path.join(outsideRoot, 'secret.png'), path.join(fixtureRoot, 'escaped.png'));
    });

    teardown(() => {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    });

    test('allows a real file beneath an allowed root', () => {
      assert.strictEqual(
        resolveSafeTexturePath(encodeURIComponent(path.join(fixtureRoot, 'texture.png')), [fixtureRoot]),
        fs.realpathSync(path.join(fixtureRoot, 'texture.png')),
      );
    });

    test('does not pass the requested texture path directly to filesystem APIs', () => {
      const requestedPath = `${fixtureRoot}${path.sep}${path.sep}texture.png`;
      const realFs = require('fs');
      const realpathSync = sandbox.spy(realFs.realpathSync);
      const { resolveSafeTexturePath: resolveTexturePath } = proxyquire('../../app/WebServer', {
        fs: Object.assign(Object.create(realFs), { realpathSync }),
      });

      assert.strictEqual(
        resolveTexturePath(encodeURIComponent(requestedPath), [fixtureRoot]),
        fs.realpathSync(path.join(fixtureRoot, 'texture.png')),
      );
      assert.ok(!realpathSync.calledWith(requestedPath));
    });

    for (const unsafePath of [
      () => '../secret.png',
      () => '%2e%2e%2fsecret.png',
      () => '%252e%252e%252fsecret.png',
      () => path.join(outsideRoot, 'secret.png'),
      () => 'not%a-valid-encoding',
    ]) {
      test('rejects an unsafe texture path', () => {
        assert.strictEqual(resolveSafeTexturePath(unsafePath(), [fixtureRoot]), undefined);
      });
    }

    test('rejects a symlink which escapes an allowed root', () => {
      assert.strictEqual(
        resolveSafeTexturePath(encodeURIComponent(path.join(fixtureRoot, 'escaped.png')), [fixtureRoot]),
        undefined,
      );
    });

    test('refuses a symlink swapped in after path validation', async () => {
      const replacement = path.join(fixtureRoot, 'replacement.png');
      fs.writeFileSync(replacement, 'safe');
      const expectedStats = fs.statSync(replacement);
      fs.unlinkSync(replacement);
      fs.symlinkSync(path.join(outsideRoot, 'secret.png'), replacement);

      await new Promise<void>((resolve, reject) => {
        openRegularFile(replacement, expectedStats, (error, fd) => {
          if (!error) {
            if (fd !== undefined) {
              fs.closeSync(fd);
            }
            reject(new Error('Expected O_NOFOLLOW to reject the replacement symlink'));
            return;
          }
          resolve();
        });
      });
    });

    test('closes and rejects a file swapped through an intermediate directory', async () => {
      const nestedRoot = path.join(fixtureRoot, 'nested');
      const outsideNested = path.join(outsideRoot, 'nested');
      fs.mkdirSync(nestedRoot);
      fs.mkdirSync(outsideNested);
      const requestedFile = path.join(nestedRoot, 'texture.png');
      fs.writeFileSync(requestedFile, 'safe');
      const expectedStats = fs.statSync(requestedFile);
      fs.writeFileSync(path.join(outsideNested, 'texture.png'), 'outside');
      fs.rmSync(nestedRoot, { recursive: true });
      fs.symlinkSync(outsideNested, nestedRoot);

      await new Promise<void>((resolve, reject) => {
        openRegularFile(requestedFile, expectedStats, (error, fd) => {
          if (!error || fd !== undefined) {
            reject(new Error('Expected identity validation to reject the swapped directory'));
            return;
          }
          resolve();
        });
      });
    });

    test('rejects a regular file whose descriptor has a different identity', async () => {
      const original = path.join(fixtureRoot, 'identity.png');
      const replacement = path.join(fixtureRoot, 'replacement.png');
      fs.writeFileSync(original, 'safe');
      fs.writeFileSync(replacement, 'replacement');
      // Keep both files alive so filesystems cannot reuse the original inode.
      const expectedStats = fs.statSync(original);

      await new Promise<void>((resolve, reject) => {
        openRegularFile(replacement, expectedStats, (error, fd) => {
          if (!error || fd !== undefined) {
            reject(new Error('Expected descriptor identity validation to reject the replacement file'));
            return;
          }
          resolve();
        });
      });
    });
  });

  suite('Texture roots', () => {
    test('uses open shader and config directories when no workspace folder is open', () => {
      const shaderDirectory = path.join(os.tmpdir(), 'loose-shader');
      const roots = collectTextureRoots(undefined, [
        { uri: vscode.Uri.file(path.join(shaderDirectory, 'demo.slang')) },
        { uri: vscode.Uri.file(path.join(shaderDirectory, 'demo.sha.json')) },
        { uri: vscode.Uri.file(path.join(os.tmpdir(), 'notes.txt')) },
        { uri: vscode.Uri.parse('untitled:Untitled-1') },
      ]);

      assert.deepStrictEqual(roots, [shaderDirectory]);
    });
  });

  suite('UI asset authorization', () => {
    let fixtureRoot!: string;
    let linkedRoot!: string;

    setup(() => {
      fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-studio-ui-root-'));
      linkedRoot = `${fixtureRoot}-link`;
      fs.writeFileSync(path.join(fixtureRoot, 'index.html'), '<html></html>');
      fs.symlinkSync(fixtureRoot, linkedRoot);
    });

    teardown(() => {
      fs.unlinkSync(linkedRoot);
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    });

    test('serves assets when the installed extension root is reached through a symlink', () => {
      assert.strictEqual(resolveSafeUiAsset('/', linkedRoot), fs.realpathSync(path.join(fixtureRoot, 'index.html')));
    });

    test('rejects traversal outside the UI distribution root', () => {
      assert.strictEqual(resolveSafeUiAsset('/../secret.txt', linkedRoot), undefined);
    });
  });

  suite('Texture CORS', () => {
    test('allows the standalone UI through equivalent loopback hostnames on the server port', () => {
      assert.deepStrictEqual(getTextureCorsHeaders('http://127.0.0.1:38473', 38473), {
        'Access-Control-Allow-Origin': 'http://127.0.0.1:38473',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        Vary: 'Origin',
      });
      assert.deepStrictEqual(getTextureCorsHeaders('http://localhost:38473', 38473), {
        'Access-Control-Allow-Origin': 'http://localhost:38473',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        Vary: 'Origin',
      });
    });

    test('allows VS Code webviews without restoring wildcard browser access', () => {
      assert.deepStrictEqual(getTextureCorsHeaders('vscode-webview://shader-studio-view', 38473), {
        'Access-Control-Allow-Origin': 'vscode-webview://shader-studio-view',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        Vary: 'Origin',
      });
      assert.deepStrictEqual(getTextureCorsHeaders('https://attacker.example', 38473), {
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
      assert.deepStrictEqual(getTextureCorsHeaders('http://localhost:9999', 38473), {
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
    });
  });

  suite('Byte ranges', () => {
    test('rejects suffix ranges for empty files', () => {
      assert.strictEqual(parseRange('bytes=-1', 0), undefined);
    });

    test('retains valid bounded and suffix ranges', () => {
      assert.deepStrictEqual(parseRange('bytes=2-5', 10), { start: 2, end: 5 });
      assert.deepStrictEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
    });

    for (const method of ['GET', 'HEAD']) {
      test(`returns 416 for an empty-file suffix range (${method})`, async () => {
        webServer = new WebServer(mockContext);
        const emptyFile = path.join(os.tmpdir(), `shader-studio-empty-${process.pid}-${method}`);
        fs.writeFileSync(emptyFile, '');
        const fd = fs.openSync(emptyFile, 'r');
        const response = { writeHead: sandbox.stub(), end: sandbox.stub() } as any;

        try {
          (webServer as any).handleRangeRequest(
            { headers: { range: 'bytes=-1' }, method },
            response,
            emptyFile,
            fd,
            { size: 0 },
          );
          await new Promise<void>((resolve) => setImmediate(resolve));

          sinon.assert.calledWith(response.writeHead, 416, { 'Content-Range': 'bytes */0' });
          sinon.assert.calledOnce(response.end);
          assert.throws(() => fs.fstatSync(fd), (error: NodeJS.ErrnoException) => error.code === 'EBADF');
        } finally {
          try {
            fs.closeSync(fd);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EBADF') {
              throw error;
            }
          }
          fs.rmSync(emptyFile, { force: true });
        }
      });
    }
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

  suite('Messenger and Server State Broadcasting', () => {
    test('setMessenger stores the messenger', () => {
      webServer = new WebServer(mockContext);
      const mockMessenger = { send: sandbox.stub() } as any;

      webServer.setMessenger(mockMessenger);

      assert.strictEqual((webServer as any).messenger, mockMessenger);
    });

    test('broadcastServerState sends webServerState via messenger', () => {
      webServer = new WebServer(mockContext);
      const mockMessenger = { send: sandbox.stub() } as any;
      webServer.setMessenger(mockMessenger);

      (webServer as any).broadcastServerState();

      sinon.assert.calledOnce(mockMessenger.send);
      const message = mockMessenger.send.firstCall.args[0];
      assert.strictEqual(message.type, 'webServerState');
      assert.strictEqual(message.payload.isRunning, false);
    });

    test('broadcastServerState does nothing without messenger', () => {
      webServer = new WebServer(mockContext);
      // No messenger set - should not throw
      (webServer as any).broadcastServerState();
    });

    test('stopWebServer calls broadcastServerState with isRunning false', () => {
      webServer = new WebServer(mockContext);
      const mockMessenger = { send: sandbox.stub() } as any;
      webServer.setMessenger(mockMessenger);

      // Force server into running state
      (webServer as any).isServerRunning = true;
      (webServer as any).httpServer = { close: sandbox.stub() };

      webServer.stopWebServer();

      sinon.assert.calledOnce(mockMessenger.send);
      const message = mockMessenger.send.firstCall.args[0];
      assert.strictEqual(message.type, 'webServerState');
      assert.strictEqual(message.payload.isRunning, false);
    });

    test('stopWebServer does nothing when server not running', () => {
      webServer = new WebServer(mockContext);
      const mockMessenger = { send: sandbox.stub() } as any;
      webServer.setMessenger(mockMessenger);

      webServer.stopWebServer();

      sinon.assert.notCalled(mockMessenger.send);
    });
  });

  suite('showWebServerMenu', () => {
    test('shows QuickPick with open, copy, stop options', async () => {
      webServer = new WebServer(mockContext);
      const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await webServer.showWebServerMenu();

      sinon.assert.calledOnce(showQuickPickStub);
      const items = showQuickPickStub.firstCall.args[0] as any[];
      assert.strictEqual(items.length, 3);
      assert.strictEqual(items[0].action, 'open');
      assert.strictEqual(items[1].action, 'copy');
      assert.strictEqual(items[2].action, 'stop');
    });

    test('opens browser when open is selected', async () => {
      webServer = new WebServer(mockContext);
      sandbox.stub(vscode.window, 'showQuickPick').resolves({ action: 'open' } as any);
      const openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);

      await webServer.showWebServerMenu();

      sinon.assert.calledOnce(openExternalStub);
    });

    test('copies URL to clipboard when copy is selected', async () => {
      webServer = new WebServer(mockContext);
      sandbox.stub(vscode.window, 'showQuickPick').resolves({ action: 'copy' } as any);
      // vscode.env.clipboard.writeText is non-configurable, so replace the whole clipboard
      const writeTextStub = sandbox.stub().resolves();
      sandbox.stub(vscode.env, 'clipboard').value({ writeText: writeTextStub, readText: sandbox.stub().resolves('') });
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as any);

      await webServer.showWebServerMenu();

      sinon.assert.calledOnce(writeTextStub);
      sinon.assert.calledWith(writeTextStub, 'http://localhost:3000');
    });

    test('stops server when stop is selected', async () => {
      webServer = new WebServer(mockContext);
      sandbox.stub(vscode.window, 'showQuickPick').resolves({ action: 'stop' } as any);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as any);

      // Force server into running state
      (webServer as any).isServerRunning = true;
      (webServer as any).httpServer = { close: sandbox.stub() };

      await webServer.showWebServerMenu();

      assert.strictEqual(webServer.isRunning(), false);
    });
  });

  suite('setWebSocketPort', () => {
    test('stores port value for HTML injection', () => {
      webServer = new WebServer(mockContext);

      webServer.setWebSocketPort(55555);

      assert.strictEqual((webServer as any).webSocketPort, 55555);
    });

    test('defaults to 0 when not set', () => {
      webServer = new WebServer(mockContext);

      assert.strictEqual((webServer as any).webSocketPort, 0);
    });

    test('can be updated multiple times', () => {
      webServer = new WebServer(mockContext);

      webServer.setWebSocketPort(1111);
      assert.strictEqual((webServer as any).webSocketPort, 1111);

      webServer.setWebSocketPort(2222);
      assert.strictEqual((webServer as any).webSocketPort, 2222);
    });
  });

  suite('Content Type Mapping', () => {
    let mockHttpServer: EventEmitter;
    let mockResponse: sinon.SinonStubbedInstance<http.ServerResponse>;

    setup(() => {
      mockHttpServer = new EventEmitter();
      (mockHttpServer as any).listen = sandbox.stub();
      (mockHttpServer as any).close = sandbox.stub();

      const { WebServer: ProxiedWebServer } = proxyquire('../../app/WebServer', {
        'fs': {
          readFile: sandbox.stub().callsFake((_filePath: string, callback: Function) => {
            callback(null, Buffer.from('file content'));
          }),
          existsSync: sandbox.stub().returns(true),
          statSync: sandbox.stub().returns({ isFile: () => true, size: 12 }),
          lstatSync: sandbox.stub().returns({ isFile: () => true, dev: 1, ino: 1 }),
          realpathSync: sandbox.stub().callsFake((filePath: string) => filePath),
          realpath: sandbox.stub().callsFake((filePath: string, callback: Function) => callback(null, filePath)),
          open: sandbox.stub().callsFake((_filePath: string, _flags: number, callback: Function) => callback(null, 1)),
          fstat: sandbox.stub().callsFake((_fd: number, callback: Function) => callback(null, { isFile: () => true, size: 12, dev: 1, ino: 1 })),
          close: sandbox.stub().callsFake((_fd: number, callback: Function) => callback())
        },
        'http': {
          createServer: sandbox.stub().callsFake((handler: any) => {
            mockHttpServer.on('request', handler);
            return mockHttpServer;
          })
        }
      });
      webServer = new ProxiedWebServer(mockContext);
      webServer.startWebServer();

      mockResponse = { writeHead: sandbox.stub(), end: sandbox.stub(), setHeader: sandbox.stub() } as any;
    });

    function requestFile(filename: string): string {
      const mockRequest = { url: `/${filename}`, method: 'GET', headers: {} };
      mockHttpServer.emit('request', mockRequest, mockResponse);
      const headers = mockResponse.writeHead.lastCall.args[1] as any;
      return headers['Content-Type'];
    }

    test('serves .ttf with font/ttf content type', () => {
      assert.strictEqual(requestFile('codicon.ttf'), 'font/ttf');
    });

    test('serves asset files when the request includes a query string', () => {
      const mockRequest = { url: '/assets/codicon.ttf?cache-bust=123', method: 'GET' } as any;
      mockHttpServer.emit('request', mockRequest, mockResponse);

      const headers = mockResponse.writeHead.lastCall.args[1] as any;
      assert.strictEqual(headers['Content-Type'], 'font/ttf');
    });

    test('serves .woff with font/woff content type', () => {
      assert.strictEqual(requestFile('font.woff'), 'font/woff');
    });

    test('serves .woff2 with font/woff2 content type', () => {
      assert.strictEqual(requestFile('font.woff2'), 'font/woff2');
    });

    test('serves .svg with image/svg+xml content type', () => {
      assert.strictEqual(requestFile('icon.svg'), 'image/svg+xml');
    });

    test('serves bundled .mp4 default assets with video content type', () => {
      assert.strictEqual(requestFile('assets/nebula-motion.mp4'), 'video/mp4');
    });

    test('serves .wasm with application/wasm content type', () => {
      assert.strictEqual(requestFile('module.wasm'), 'application/wasm');
    });

    test('serves .js with application/javascript content type', () => {
      assert.strictEqual(requestFile('app.js'), 'application/javascript');
    });

    test('serves .css with text/css content type', () => {
      assert.strictEqual(requestFile('style.css'), 'text/css');
    });

    test('serves .json with application/json content type', () => {
      assert.strictEqual(requestFile('data.json'), 'application/json');
    });

    test('serves .png with image/png content type', () => {
      assert.strictEqual(requestFile('image.png'), 'image/png');
    });

    test('serves .jpg with image/jpeg content type', () => {
      assert.strictEqual(requestFile('photo.jpg'), 'image/jpeg');
    });

    test('serves unknown extensions with text/html content type', () => {
      assert.strictEqual(requestFile('file.xyz'), 'text/html');
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
          existsSync: sandbox.stub().returns(true),
          lstatSync: sandbox.stub().returns({ isFile: () => true, dev: 1, ino: 1 }),
          realpathSync: sandbox.stub().callsFake((filePath: string) => filePath),
          realpath: sandbox.stub().callsFake((filePath: string, callback: Function) => callback(null, filePath)),
          open: sandbox.stub().callsFake((_filePath: string, _flags: number, callback: Function) => callback(null, 1)),
          fstat: sandbox.stub().callsFake((_fd: number, callback: Function) => callback(null, { isFile: () => true, size: 12, dev: 1, ino: 1 })),
          close: sandbox.stub().callsFake((_fd: number, callback: Function) => callback())
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

    test('should inject WebSocket port set via setWebSocketPort into index.html', () => {
      const testPort = 9999;
      webServer.setWebSocketPort(testPort);

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

    test('should inject port 0 when setWebSocketPort has not been called', () => {
      // When: The server receives a request for index.html (no setWebSocketPort called)
      mockHttpServer.emit('request', mockRequest, mockResponse);

      // Then: The response should contain port 0 (default)
      const responseBody = mockResponse.end.getCall(0).args[0];
      const responseString = Buffer.isBuffer(responseBody) ? responseBody.toString() : responseBody;
      const expectedScript = `<script>window.shaderViewConfig = { port: 0 };</script>`;
      assert.ok(responseString.includes(expectedScript), `HTML should contain port 0 when not set. Got: ${responseString}`);
    });
  });
});
