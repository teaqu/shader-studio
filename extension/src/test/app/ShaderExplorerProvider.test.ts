import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { decodeHTMLAttribute } from 'entities';
import { ShaderExplorerProvider } from '../../app/ShaderExplorerProvider';
import { ShaderConfigProcessor } from '../../app/ShaderConfigProcessor';
import { ConfigPathConverter } from '../../app/transport/ConfigPathConverter';
import { Logger } from '../../app/services/Logger';
import { ScriptBundler } from '../../app/ScriptBundler';
import { ScriptEvaluator } from '../../app/ScriptEvaluator';

suite('ShaderExplorerProvider Test Suite', () => {
  let provider: ShaderExplorerProvider;
  let mockContext: vscode.ExtensionContext;
  let sandbox: sinon.SinonSandbox;
  let mockPanel: any;
  let mockWebview: any;
  let postMessageSpy: sinon.SinonSpy;
  let existsSyncStub: sinon.SinonStub;
  let readFileSyncStub: sinon.SinonStub;
  let loggerErrorStub: sinon.SinonStub;

  setup(() => {
    sandbox = sinon.createSandbox();
        
    // Initialize Logger for tests with mock output channel
    loggerErrorStub = sandbox.stub();
    const mockOutputChannel = {
      name: 'test',
      append: sandbox.stub(),
      appendLine: sandbox.stub(),
      clear: sandbox.stub(),
      show: sandbox.stub(),
      hide: sandbox.stub(),
      dispose: sandbox.stub(),
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: loggerErrorStub,
      debug: sandbox.stub(),
      trace: sandbox.stub()
    } as any;
    Logger.initialize(mockOutputChannel);

    sandbox.stub(vscode.workspace, 'getWorkspaceFolder').callsFake((uri: vscode.Uri) => (
      uri.fsPath.startsWith('/test/')
        ? { uri: vscode.Uri.file('/test'), name: 'test', index: 0 } as vscode.WorkspaceFolder
        : undefined
    ));
        
    // Mock filesystem operations to prevent ThumbnailCache from creating real directories
    const fs = require('fs');
    existsSyncStub = sandbox.stub(fs, 'existsSync').callsFake((...args: any[]) => {
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
    readFileSyncStub = sandbox.stub(fs, 'readFileSync').callsFake((...args: any[]) => {
      const path = args[0] as string;
      // Return mock HTML for HTML files
      if (path.includes('index.html')) {
        return '<html><head></head><body>Mock Shader Explorer</body></html>';
      }
      return '<html><head></head><body></body></html>';
    });

    // Create mock webview
    postMessageSpy = sandbox.spy();
    mockWebview = {
      postMessage: postMessageSpy,
      asWebviewUri: sandbox.stub().callsFake((uri: vscode.Uri) => uri),
      cspSource: 'vscode-webview://test-source',
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

    provider = new ShaderExplorerProvider(mockContext);
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

  function configureExplorerHtml(html: string): void {
    existsSyncStub.callsFake((filePath: string) => !filePath.includes('index.html') || filePath.includes('shader-explorer-dist'));
    readFileSyncStub.callsFake((filePath: string) => {
      if (filePath.endsWith('slang-assets.json')) {
        return JSON.stringify({
          script: 'assets/slang.js',
          wasm: 'assets/slang.wasm',
          worker: 'assets/slang-worker.js',
        });
      }
      if (filePath.includes('shader-explorer-dist') && filePath.endsWith('index.html')) {
        return html;
      }
      return '<html><head></head><body></body></html>';
    });
  }

  function showExplorer(): void {
    sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
    provider.show();
  }

  function getCsp(html: string): string {
    const meta = (html.match(/<meta(?:\s[^>]*)?>/gi) ?? []).find(tag => {
      const httpEquiv = tag.match(/(?:^|\s)http-equiv\s*=\s*(["'])(.*?)\1/i)?.[2];
      return httpEquiv !== undefined
        && decodeHTMLAttribute(httpEquiv).toLowerCase() === 'content-security-policy';
    });
    const content = meta?.match(/(?:^|\s)content\s*=\s*(["'])(.*?)\1/i)?.[2];
    assert.ok(content, 'Expected a Content-Security-Policy meta tag');
    return decodeHTMLAttribute(content);
  }

  function getDirective(csp: string, name: string): string | undefined {
    return csp
      .split(';')
      .map(directive => directive.trim())
      .find(directive => directive.split(/\s+/, 1)[0].toLowerCase() === name.toLowerCase());
  }

  function countDirectives(csp: string, name: string): number {
    return csp
      .split(';')
      .map(directive => directive.trim())
      .filter(directive => directive.split(/\s+/, 1)[0].toLowerCase() === name.toLowerCase())
      .length;
  }

  function countCspMetas(html: string): number {
    return (html.match(/<meta(?:\s[^>]*)?>/gi) ?? []).filter(tag => {
      const httpEquiv = tag.match(/(?:^|\s)http-equiv\s*=\s*(["'])(.*?)\1/i)?.[2];
      return httpEquiv !== undefined
        && decodeHTMLAttribute(httpEquiv).toLowerCase() === 'content-security-policy';
    }).length;
  }

  function getHead(html: string): string {
    const head = html.match(/<head(?:\s[^>]*)?>(.*?)<\/head>/is)?.[1];
    assert.ok(head, 'Expected a real head element');
    return head;
  }

  suite('Command Registration', () => {
    test('should register shader explorer command', () => {
      const registerCommandStub = sandbox.stub(vscode.commands, 'registerCommand').returns({
        dispose: sandbox.stub()
      } as any);

      const disposable = ShaderExplorerProvider.register(mockContext);

      assert.ok(registerCommandStub.calledOnce);
      assert.strictEqual(registerCommandStub.firstCall.args[0], 'shader-studio.openShaderExplorer');
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

      assert.strictEqual(createWebviewPanelStub.firstCall.args[0], 'shader-studio.shaderExplorer');
      assert.strictEqual(createWebviewPanelStub.firstCall.args[1], 'Shader Explorer');
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
      assert.deepStrictEqual(
        options.localResourceRoots.map((root: vscode.Uri) => root.fsPath),
        [
          '/mock/extension/path/shader-explorer-dist',
          '/mock/extension/path/ui-dist',
          '/workspace',
        ],
      );
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

  suite('Webview HTML', () => {
    test('creates a real head with exact Slang metadata and CSP when HTML has no head', () => {
      configureExplorerHtml('<html><body>Explorer</body></html>');
      mockWebview.asWebviewUri.callsFake((uri: vscode.Uri) => ({
        toString: () => `mapped:${uri.fsPath}`,
      }));

      showExplorer();

      const head = mockWebview.html.match(/<head>(.*?)<\/head>/s)?.[1];
      assert.ok(head, 'Expected a real head element');
      assert.ok(head.includes('<meta name="shader-studio-slang-script-url" content="mapped:/mock/extension/path/ui-dist/assets/slang.js">'));
      assert.ok(head.includes('<meta name="shader-studio-slang-wasm-url" content="mapped:/mock/extension/path/ui-dist/assets/slang.wasm">'));
      assert.ok(head.includes('<meta name="shader-studio-slang-worker-url" content="mapped:/mock/extension/path/ui-dist/assets/slang-worker.js">'));
      assert.ok(head.includes('http-equiv="Content-Security-Policy"'));
      assert.ok(mockWebview.html.indexOf('<head>') < mockWebview.html.indexOf('<body>'));
    });

    test('does not mistake a body header element for the document head', () => {
      configureExplorerHtml('<html><body><header>Explorer title</header></body></html>');

      showExplorer();

      assert.match(mockWebview.html, /<html><head>.*<\/head><body><header>Explorer title<\/header>/s);
      assert.strictEqual((mockWebview.html.match(/<head(?:\s[^>]*)?>/gi) ?? []).length, 1);
      assert.strictEqual((mockWebview.html.match(/<header(?:\s[^>]*)?>/gi) ?? []).length, 1);
    });

    test('moves the effective policy into a generated head when the source CSP is in the body', () => {
      configureExplorerHtml(`<html><body>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src body-source:">
        Explorer
      </body></html>`);

      showExplorer();

      const head = getHead(mockWebview.html);
      assert.strictEqual(countCspMetas(mockWebview.html), 1);
      assert.strictEqual(countCspMetas(head), 1);
      assert.strictEqual((head.match(/name="shader-studio-slang-(?:script|wasm|worker)-url"/g) ?? []).length, 3);
      assert.ok(getDirective(getCsp(head), 'script-src')?.includes("'unsafe-eval'"));
    });

    test('does not mistake htmlish for html when creating the document head', () => {
      configureExplorerHtml('<htmlish><body>Explorer</body></htmlish>');

      showExplorer();

      const head = getHead(mockWebview.html);
      assert.ok(mockWebview.html.startsWith('<head>'));
      assert.ok(mockWebview.html.includes('<htmlish>'));
      assert.strictEqual(countCspMetas(head), 1);
      assert.strictEqual((head.match(/name="shader-studio-slang-(?:script|wasm|worker)-url"/g) ?? []).length, 3);
    });

    test('adds Slang asset metadata and required directives to an existing CSP without duplicate tokens', () => {
      configureExplorerHtml(`<!doctype html><html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' blob: 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; worker-src stale:; connect-src stale:">
      </head><body><script src="./assets/explorer.js"></script></body></html>`);

      showExplorer();

      const csp = getCsp(mockWebview.html);
      assert.match(csp, /script-src[^;]*vscode-webview:\/\/test-source/);
      assert.match(csp, /script-src[^;]*blob:/);
      assert.match(csp, /script-src[^;]*'wasm-unsafe-eval'/);
      assert.match(csp, /script-src[^;]*'unsafe-eval'/);
      assert.match(csp, /worker-src vscode-webview:\/\/test-source blob:/);
      assert.match(csp, /connect-src vscode-webview:\/\/test-source blob:/);
      assert.match(csp, /style-src 'self' 'unsafe-inline' vscode-webview:\/\/test-source/);
      assert.match(csp, /img-src 'self' data: blob: vscode-webview:\/\/test-source/);
      assert.match(csp, /media-src 'self' blob: vscode-webview:\/\/test-source/);
      assert.match(csp, /font-src 'self'/);
      const scriptDirective = csp.match(/script-src[^;]*/)?.[0] ?? '';
      assert.strictEqual((scriptDirective.match(/blob:/g) ?? []).length, 1);
      assert.strictEqual((scriptDirective.match(/'unsafe-eval'/g) ?? []).length, 1);
      assert.strictEqual((mockWebview.html.match(/name="shader-studio-slang-(?:script|wasm|worker)-url"/g) ?? []).length, 3);
    });

    test('updates mixed-case CSP directives without adding case-variant duplicates', () => {
      configureExplorerHtml(`<html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'self'; ScRiPt-SrC 'self'; StYlE-SrC 'self'; ImG-SrC 'self'; MeDiA-SrC 'self'; WoRkEr-SrC stale:; CoNnEcT-SrC stale:; FoNt-SrC 'self'">
      </head><body>Explorer</body></html>`);

      showExplorer();

      const csp = getCsp(mockWebview.html);
      for (const directive of ['script-src', 'style-src', 'img-src', 'media-src', 'worker-src', 'connect-src']) {
        assert.strictEqual(countDirectives(csp, directive), 1, `Expected one ${directive}`);
      }
      assert.ok(getDirective(csp, 'script-src')?.includes("'unsafe-eval'"));
      assert.strictEqual(getDirective(csp, 'worker-src'), 'worker-src vscode-webview://test-source blob:');
      assert.strictEqual(getDirective(csp, 'connect-src'), 'connect-src vscode-webview://test-source blob:');
    });

    test('adds exact script-src without modifying script-src-elem', () => {
      configureExplorerHtml(`<html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src-elem 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'">
      </head><body>Explorer</body></html>`);

      showExplorer();

      const csp = getCsp(mockWebview.html);
      assert.strictEqual(getDirective(csp, 'script-src-elem'), "script-src-elem 'self'");
      assert.strictEqual(countDirectives(csp, 'script-src'), 1);
      assert.ok(getDirective(csp, 'script-src')?.includes("'wasm-unsafe-eval'"));
    });

    test('recognizes a CSP meta with reversed and intervening attributes', () => {
      configureExplorerHtml(`<html><head>
        <meta data-owner="explorer" content="default-src 'self'; script-src 'self'" id="policy" HTTP-EQUIV="content-security-policy">
      </head><body>Explorer</body></html>`);

      showExplorer();

      assert.strictEqual(countCspMetas(mockWebview.html), 1);
      const csp = getCsp(mockWebview.html);
      assert.ok(getDirective(csp, 'script-src')?.includes("'unsafe-eval'"));
    });

    test('safely rewrites an entity-encoded single-quoted CSP content attribute', () => {
      configureExplorerHtml(`<html><head>
        <meta data-owner="explorer" content='default-src &apos;self&apos;; script-src &apos;self&apos;' id="policy" http-equiv="Content-Security-Policy">
      </head><body>Explorer</body></html>`);

      showExplorer();

      assert.strictEqual(countCspMetas(mockWebview.html), 1);
      assert.match(
        mockWebview.html,
        /<meta data-owner="explorer" content="default-src 'self'; script-src 'self'[^>]+" id="policy" http-equiv="Content-Security-Policy">/,
      );
      assert.ok(!mockWebview.html.includes('&amp;apos;'));
      const csp = getCsp(mockWebview.html);
      assert.strictEqual(countDirectives(csp, 'script-src'), 1);
      assert.ok(getDirective(csp, 'script-src')?.includes("'unsafe-eval'"));
    });

    test('recognizes an entity-encoded http-equiv without adding a second effective CSP', () => {
      configureExplorerHtml(`<html><head>
        <meta data-owner="explorer" content="default-src 'none'; object-src 'none'" http-equiv="Content-Security-Polic&#x79;">
      </head><body>Explorer</body></html>`);

      showExplorer();

      assert.strictEqual(countCspMetas(mockWebview.html), 1);
      const csp = getCsp(mockWebview.html);
      assert.strictEqual(getDirective(csp, 'default-src'), "default-src 'none'");
      assert.strictEqual(getDirective(csp, 'object-src'), "object-src 'none'");
      assert.ok(getDirective(csp, 'script-src')?.includes("'unsafe-eval'"));
    });

    test('decodes named colon and semicolon references before updating the effective CSP', () => {
      configureExplorerHtml(`<html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'&semi; script-src https&colon;//assets.test">
      </head><body>Explorer</body></html>`);

      showExplorer();

      assert.strictEqual(countCspMetas(mockWebview.html), 1);
      const csp = getCsp(mockWebview.html);
      assert.strictEqual(getDirective(csp, 'default-src'), "default-src 'none'");
      assert.ok(getDirective(csp, 'script-src')?.includes('https://assets.test'));
      assert.strictEqual(countDirectives(csp, 'script-src'), 1);
    });

    test('decodes decimal and hexadecimal references before updating the effective CSP', () => {
      configureExplorerHtml(`<html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;&#59; script-src https&#x3a;//numeric.test">
      </head><body>Explorer</body></html>`);

      showExplorer();

      assert.strictEqual(countCspMetas(mockWebview.html), 1);
      const csp = getCsp(mockWebview.html);
      assert.strictEqual(getDirective(csp, 'default-src'), "default-src 'none'");
      assert.ok(getDirective(csp, 'script-src')?.includes('https://numeric.test'));
      assert.strictEqual(countDirectives(csp, 'script-src'), 1);
    });

    test('decodes permitted semicolonless references using HTML attribute rules', () => {
      configureExplorerHtml(`<html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; report-uri /&copy report-endpoint">
      </head><body>Explorer</body></html>`);

      showExplorer();

      assert.strictEqual(countCspMetas(mockWebview.html), 1);
      const csp = getCsp(mockWebview.html);
      assert.strictEqual(getDirective(csp, 'default-src'), "default-src 'none'");
      assert.strictEqual(getDirective(csp, 'report-uri'), 'report-uri /© report-endpoint');
    });

    test('uses HTML replacement behavior for invalid and out-of-range numeric references', () => {
      configureExplorerHtml(`<html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; report-uri /null-&#0;/out-&#x110000;/surrogate-&#xD800;">
      </head><body>Explorer</body></html>`);

      showExplorer();

      assert.strictEqual(countCspMetas(mockWebview.html), 1);
      const csp = getCsp(mockWebview.html);
      assert.strictEqual(getDirective(csp, 'default-src'), "default-src 'none'");
      assert.strictEqual(
        getDirective(csp, 'report-uri'),
        'report-uri /null-�/out-�/surrogate-�',
      );
    });

    test('does not recursively decode an ampersand-produced character reference', () => {
      configureExplorerHtml(`<html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; report-uri /https&amp;colon;//literal.test">
      </head><body>Explorer</body></html>`);

      showExplorer();

      assert.strictEqual(countCspMetas(mockWebview.html), 1);
      const csp = getCsp(mockWebview.html);
      assert.strictEqual(getDirective(csp, 'default-src'), "default-src 'none'");
      assert.strictEqual(getDirective(csp, 'report-uri'), 'report-uri /https&colon');
      assert.strictEqual(getDirective(csp, '//literal.test'), '//literal.test');
      assert.ok(!csp.includes('https://literal.test'));
    });

    test('adds a Slang-compatible CSP and escaped asset metadata when the source has no CSP', () => {
      configureExplorerHtml('<html><head></head><body>Explorer</body></html>');
      mockWebview.asWebviewUri.callsFake((uri: vscode.Uri) => ({
        toString: () => `vscode-webview://assets/${path.basename(uri.fsPath)}?label=a&value=\"b\"<c>`,
      }));

      showExplorer();

      const csp = getCsp(mockWebview.html);
      assert.match(csp, /script-src[^;]*vscode-webview:\/\/test-source[^;]*blob:[^;]*'wasm-unsafe-eval'[^;]*'unsafe-eval'/);
      assert.match(csp, /worker-src vscode-webview:\/\/test-source blob:/);
      assert.match(csp, /connect-src vscode-webview:\/\/test-source blob:/);
      assert.match(csp, /style-src[^;]*vscode-webview:\/\/test-source/);
      assert.match(csp, /img-src[^;]*data:[^;]*blob:/);
      assert.match(csp, /media-src[^;]*blob:/);
      assert.match(csp, /font-src 'self'/);
      assert.ok(mockWebview.html.includes('name="shader-studio-slang-script-url"'));
      assert.ok(mockWebview.html.includes('a&amp;value=&quot;b&quot;&lt;c&gt;'));
      assert.strictEqual((mockWebview.html.match(/name="shader-studio-slang-(?:script|wasm|worker)-url"/g) ?? []).length, 3);
    });

    test('keeps GLSL Explorer HTML usable when the Slang asset manifest is invalid', () => {
      configureExplorerHtml('<!doctype html><html><head></head><body><script src="./assets/explorer.js"></script></body></html>');
      readFileSyncStub.withArgs('/mock/extension/path/ui-dist/slang-assets.json', 'utf8').throws(new Error('invalid manifest'));

      showExplorer();

      assert.ok(mockWebview.html.includes('Mock Shader Explorer') === false);
      assert.ok(mockWebview.html.includes('explorer.js'));
      assert.ok(getCsp(mockWebview.html).includes("script-src 'self' 'unsafe-inline'"));
      assert.ok(!mockWebview.html.includes('shader-studio-slang-script-url'));
      const csp = getCsp(mockWebview.html);
      const scriptSrc = getDirective(csp, 'script-src') ?? '';
      assert.ok(!scriptSrc.includes('blob:'));
      assert.ok(!scriptSrc.includes("'wasm-unsafe-eval'"));
      assert.ok(scriptSrc.includes("'unsafe-eval'"));
      assert.ok(!getDirective(csp, 'worker-src')?.includes('blob:'));
      assert.ok(!getDirective(csp, 'connect-src')?.includes('blob:'));
      assert.ok(loggerErrorStub.calledWithMatch('Slang assets unavailable in Shader Explorer: Error: invalid manifest'));
    });

    test('does not partially inject Slang metadata when asset URI conversion fails', () => {
      configureExplorerHtml('<html><body>GLSL Explorer</body></html>');
      mockWebview.asWebviewUri.callsFake((uri: vscode.Uri) => {
        if (uri.fsPath.endsWith('slang.wasm')) {
          throw new Error('WASM URI conversion failed');
        }
        return uri;
      });

      showExplorer();

      assert.ok(mockWebview.html.includes('GLSL Explorer'));
      assert.strictEqual((mockWebview.html.match(/name="shader-studio-slang-(?:script|wasm|worker)-url"/g) ?? []).length, 0);
      const csp = getCsp(getHead(mockWebview.html));
      const scriptSrc = getDirective(csp, 'script-src') ?? '';
      assert.ok(!scriptSrc.includes('blob:'));
      assert.ok(!scriptSrc.includes("'wasm-unsafe-eval'"));
      assert.ok(scriptSrc.includes("'unsafe-eval'"));
      assert.ok(!getDirective(csp, 'worker-src')?.includes('blob:'));
      assert.ok(!getDirective(csp, 'connect-src')?.includes('blob:'));
      assert.ok(loggerErrorStub.calledWithMatch('Slang assets unavailable in Shader Explorer: Error: WASM URI conversion failed'));
    });
  });

  suite('Message Handling - requestShaders', () => {
    test('should discover Slang shaders with config metadata', async () => {
      const fs = require('fs');
      const shaderUri = vscode.Uri.file('/workspace/shaders/example.slang');
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace') },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const findFilesStub = sandbox.stub(vscode.workspace, 'findFiles').resolves([shaderUri]);
      existsSyncStub.callsFake((filePath: string) =>
        filePath === '/workspace/shaders/example.sha.json'
        || !filePath.includes('index.html')
      );
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 2_000, birthtimeMs: 1_000 });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaders', skipCache: false });

      const pattern = findFilesStub.firstCall.args[0] as vscode.RelativePattern;
      assert.strictEqual(pattern.pattern, '**/*.{glsl,frag,vert,slang}');
      const shader = postMessageSpy.firstCall.args[0].shaders[0];
      assert.strictEqual(shader.name, 'example.slang');
      assert.strictEqual(shader.path, shaderUri.fsPath);
      assert.strictEqual(shader.configPath, '/workspace/shaders/example.sha.json');
      assert.strictEqual(shader.hasConfig, true);
      assert.strictEqual(shader.modifiedTime, 2_000);
      assert.strictEqual(shader.createdTime, 1_000);
    });

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

    test('should prefer git timestamps when they are available', async () => {
      const fs = require('fs');
      const workspaceRoot = '/workspace';
      const shaderUri = vscode.Uri.file('/workspace/shaders/git-newer.glsl');
      const gitMetadataProvider = {
        clearCache: sandbox.stub(),
        getMetadataForWorkspace: sandbox.stub().resolves({
          repoRoot: workspaceRoot,
          metadataByPath: new Map([
            ['shaders/git-newer.glsl', {
              modifiedTime: 5_000,
              createdTime: 4_000,
            }],
          ]),
          dirtyPaths: new Set(),
        }),
      };
      provider = new ShaderExplorerProvider(mockContext, gitMetadataProvider);
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file(workspaceRoot) }
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([shaderUri]);
      sandbox.stub(fs, 'statSync').returns({
        mtimeMs: 1_000,
        birthtimeMs: 2_000,
      });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaders', skipCache: false });

      const shader = postMessageSpy.firstCall.args[0].shaders[0];
      assert.strictEqual(shader.modifiedTime, 5_000);
      assert.strictEqual(shader.createdTime, 4_000);
    });

    test('should prefer git updated timestamp even when filesystem modified time is later', async () => {
      const fs = require('fs');
      const workspaceRoot = '/workspace';
      const shaderUri = vscode.Uri.file('/workspace/shaders/fs-newer.frag');
      const gitMetadataProvider = {
        clearCache: sandbox.stub(),
        getMetadataForWorkspace: sandbox.stub().resolves({
          repoRoot: workspaceRoot,
          metadataByPath: new Map([
            ['shaders/fs-newer.frag', {
              modifiedTime: 1_000,
              createdTime: 2_000,
            }],
          ]),
          dirtyPaths: new Set(),
        }),
      };
      provider = new ShaderExplorerProvider(mockContext, gitMetadataProvider);
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file(workspaceRoot) }
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([shaderUri]);
      sandbox.stub(fs, 'statSync').returns({
        mtimeMs: 5_000,
        birthtimeMs: 6_000,
      });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaders', skipCache: false });

      const shader = postMessageSpy.firstCall.args[0].shaders[0];
      assert.strictEqual(shader.modifiedTime, 1_000);
      assert.strictEqual(shader.createdTime, 2_000);
    });

    test('should prefer git created timestamp even when filesystem birth time is later', async () => {
      const fs = require('fs');
      const workspaceRoot = '/workspace';
      const shaderUri = vscode.Uri.file('/workspace/shaders/cloned.glsl');
      const gitMetadataProvider = {
        clearCache: sandbox.stub(),
        getMetadataForWorkspace: sandbox.stub().resolves({
          repoRoot: workspaceRoot,
          metadataByPath: new Map([
            ['shaders/cloned.glsl', {
              modifiedTime: 2_000,
              createdTime: 1_000,
            }],
          ]),
          dirtyPaths: new Set(),
        }),
      };
      provider = new ShaderExplorerProvider(mockContext, gitMetadataProvider);
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file(workspaceRoot) }
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([shaderUri]);
      sandbox.stub(fs, 'statSync').returns({
        mtimeMs: 3_000,
        birthtimeMs: 9_000,
      });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaders', skipCache: false });

      const shader = postMessageSpy.firstCall.args[0].shaders[0];
      assert.strictEqual(shader.modifiedTime, 2_000);
      assert.strictEqual(shader.createdTime, 1_000);
    });

    test('should fall back to filesystem timestamps for untracked shaders', async () => {
      const fs = require('fs');
      const workspaceRoot = '/workspace';
      const shaderUri = vscode.Uri.file('/workspace/shaders/untracked.vert');
      const gitMetadataProvider = {
        clearCache: sandbox.stub(),
        getMetadataForWorkspace: sandbox.stub().resolves({
          repoRoot: workspaceRoot,
          metadataByPath: new Map(),
          dirtyPaths: new Set(),
        }),
      };
      provider = new ShaderExplorerProvider(mockContext, gitMetadataProvider);
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file(workspaceRoot) }
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([shaderUri]);
      sandbox.stub(fs, 'statSync').returns({
        mtimeMs: 7_000,
        birthtimeMs: 8_000,
      });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaders', skipCache: false });

      const shader = postMessageSpy.firstCall.args[0].shaders[0];
      assert.strictEqual(shader.modifiedTime, 7_000);
      assert.strictEqual(shader.createdTime, 8_000);
    });

    test('dirty tracked file uses filesystem mtime and git createdTime', async () => {
      const fs = require('fs');
      const workspaceRoot = '/workspace';
      const shaderUri = vscode.Uri.file('/workspace/shaders/dirty.glsl');
      const gitMetadataProvider = {
        clearCache: sandbox.stub(),
        getMetadataForWorkspace: sandbox.stub().resolves({
          repoRoot: workspaceRoot,
          metadataByPath: new Map([
            ['shaders/dirty.glsl', { modifiedTime: 1_000, createdTime: 500 }],
          ]),
          dirtyPaths: new Set(['shaders/dirty.glsl']),
        }),
      };
      provider = new ShaderExplorerProvider(mockContext, gitMetadataProvider);
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file(workspaceRoot) },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([shaderUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 9_000, birthtimeMs: 8_000 });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaders', skipCache: false });

      const shader = postMessageSpy.firstCall.args[0].shaders[0];
      assert.strictEqual(shader.modifiedTime, 9_000, 'dirty: filesystem mtime');
      assert.strictEqual(shader.createdTime, 500, 'dirty: git createdTime');
    });

    test('dirty new file with no git history uses filesystem for both timestamps', async () => {
      const fs = require('fs');
      const workspaceRoot = '/workspace';
      const shaderUri = vscode.Uri.file('/workspace/shaders/new.glsl');
      const gitMetadataProvider = {
        clearCache: sandbox.stub(),
        getMetadataForWorkspace: sandbox.stub().resolves({
          repoRoot: workspaceRoot,
          metadataByPath: new Map(),
          dirtyPaths: new Set(['shaders/new.glsl']),
        }),
      };
      provider = new ShaderExplorerProvider(mockContext, gitMetadataProvider);
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file(workspaceRoot) },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([shaderUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 7_000, birthtimeMs: 3_000 });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaders', skipCache: false });

      const shader = postMessageSpy.firstCall.args[0].shaders[0];
      assert.strictEqual(shader.modifiedTime, 7_000, 'new dirty: filesystem mtime');
      assert.strictEqual(shader.createdTime, 3_000, 'new dirty: filesystem birthtime');
    });

    test('dirty file always uses filesystem mtime regardless of git committed time', async () => {
      const fs = require('fs');
      const workspaceRoot = '/workspace';
      const shaderUri = vscode.Uri.file('/workspace/shaders/reverted.glsl');
      const gitMetadataProvider = {
        clearCache: sandbox.stub(),
        getMetadataForWorkspace: sandbox.stub().resolves({
          repoRoot: workspaceRoot,
          metadataByPath: new Map([
            ['shaders/reverted.glsl', { modifiedTime: 99_000, createdTime: 100 }],
          ]),
          dirtyPaths: new Set(['shaders/reverted.glsl']),
        }),
      };
      provider = new ShaderExplorerProvider(mockContext, gitMetadataProvider);
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file(workspaceRoot) },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([shaderUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 5_000, birthtimeMs: 100 });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaders', skipCache: false });

      const shader = postMessageSpy.firstCall.args[0].shaders[0];
      assert.strictEqual(shader.modifiedTime, 5_000, 'dirty always uses filesystem mtime');
    });

    test('should keep git metadata isolated across multiple workspaces', async () => {
      const fs = require('fs');
      const firstUri = vscode.Uri.file('/workspace-a/shader.glsl');
      const secondUri = vscode.Uri.file('/workspace-b/shader.glsl');
      const gitMetadataProvider = {
        clearCache: sandbox.stub(),
        getMetadataForWorkspace: sandbox.stub(),
      };
      gitMetadataProvider.getMetadataForWorkspace
        .withArgs('/workspace-a', ['/workspace-a/shader.glsl'])
        .resolves({
          repoRoot: '/workspace-a',
          metadataByPath: new Map([
            ['shader.glsl', { modifiedTime: 10_000, createdTime: 1_000 }],
          ]),
          dirtyPaths: new Set(),
        });
      gitMetadataProvider.getMetadataForWorkspace
        .withArgs('/workspace-b', ['/workspace-b/shader.glsl'])
        .resolves({
          repoRoot: '/workspace-b',
          metadataByPath: new Map([
            ['shader.glsl', { modifiedTime: 20_000, createdTime: 2_000 }],
          ]),
          dirtyPaths: new Set(),
        });
      provider = new ShaderExplorerProvider(mockContext, gitMetadataProvider);
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace-a') },
        { uri: vscode.Uri.file('/workspace-b') },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const findFilesStub = sandbox.stub(vscode.workspace, 'findFiles');
      findFilesStub.onFirstCall().resolves([firstUri]);
      findFilesStub.onSecondCall().resolves([secondUri]);
      sandbox.stub(fs, 'statSync').returns({
        mtimeMs: 1_000,
        birthtimeMs: 1_000,
      });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaders', skipCache: false });

      const shaders = postMessageSpy.firstCall.args[0].shaders;
      const first = shaders.find((shader: any) => shader.path === '/workspace-a/shader.glsl');
      const second = shaders.find((shader: any) => shader.path === '/workspace-b/shader.glsl');
      assert.strictEqual(first.modifiedTime, 10_000);
      assert.strictEqual(second.modifiedTime, 20_000);
    });
  });

  suite('Message Handling - requestShaderCode', () => {
    test('should send shader code on requestShaderCode message', async () => {
      const mockDocument = {
        getText: () => 'void main() { gl_FragColor = vec4(1.0); }'
      };
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
      sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns(null);
      // ConfigPathConverter.processConfigPaths is now async - stub to pass through
      sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async (msg: any) => msg);

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: '/test/shader.glsl', requestId: 42 });

      assert.ok(postMessageSpy.calledOnce);
      const message = postMessageSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderCode');
      assert.strictEqual(message.path, '/test/shader.glsl');
      assert.strictEqual(message.requestId, 42);
      assert.strictEqual(message.code, 'void main() { gl_FragColor = vec4(1.0); }');
      assert.strictEqual(message.language, 'glsl');
    });

    test('should send Slang language through config path conversion', async () => {
      const mockDocument = {
        getText: () => '[shader("fragment")] float4 fragmentMain() : SV_Target { return 1; }'
      };
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
      sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns(null);
      const processConfigPathsStub = sandbox
        .stub(ConfigPathConverter, 'processConfigPaths')
        .callsFake(async (message: any) => ({ ...message, converted: true }));

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: '/test/shader.slang' });

      assert.strictEqual(processConfigPathsStub.firstCall.args[0].language, 'slang');
      assert.strictEqual(postMessageSpy.firstCall.args[0].language, 'slang');
      assert.strictEqual(postMessageSpy.firstCall.args[0].converted, true);
    });

    test('includes imported Slang modules so explorer previews compile with their dependencies', async () => {
      const mockDocument = {
        getText: () => 'import substep;\nfloat4 mainImage(float2 fragCoord) { return float4(substepValue()); }',
      };
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
      sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns(null);
      sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async (message: any) => message);
      readFileSyncStub.withArgs('/test/substep.slang', 'utf-8').returns(
        'module substep;\npublic float substepValue() { return 1.0; }',
      );

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: '/test/image.slang' });

      assert.deepStrictEqual(postMessageSpy.firstCall.args[0].slangModules, [{
        moduleName: 'substep',
        path: '/test/substep.slang',
        source: 'module substep;\npublic float substepValue() { return 1.0; }',
        ownerPass: 'Image',
      }]);
    });

    test('does not use the owning image shader when previewing a configured compute pass', async () => {
      const rootPath = '/test/repeated-substeps.slang';
      const passPath = '/test/passes/substep.slang';
      const configPath = '/test/repeated-substeps.sha.json';
      const config = {
        passes: { ComputeSubsteps: { type: 'compute', path: './passes/substep.slang' } },
        storage: { laneA: { count: 128, stride: 16, elementType: 'float4' } },
      } as any;
      existsSyncStub.callsFake((filePath: string) => ![
        '/test/passes/substep.sha.json',
        '/test/repeated-substeps.glsl',
        '/test/repeated-substeps.frag',
      ].includes(filePath));
      sandbox.stub(vscode.workspace, 'findFiles').resolves([vscode.Uri.file(configPath)]);
      sandbox.stub(vscode.workspace, 'openTextDocument').callsFake((async (filePath: string | vscode.Uri) => ({
        getText: () => (typeof filePath === 'string' ? filePath : filePath.fsPath) === rootPath
          ? 'float4 mainImage(float2 fragCoord) { return laneA[0]; }'
          : 'void computeMain(uint3 tid) { laneA[tid.x] = 0.0; }',
      })) as any);
      sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').callsFake((_path: string, buffers: Record<string, string>) => {
        buffers.ComputeSubsteps = 'void computeMain(uint3 tid) { laneA[tid.x] = 0.0; }';
        return config;
      });
      sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async (message: any) => message);

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: passPath });

      const message = postMessageSpy.firstCall.args[0];
      assert.strictEqual(message.path, passPath);
      assert.strictEqual(message.previewPath, passPath);
      assert.strictEqual(message.code, 'void computeMain(uint3 tid) { laneA[tid.x] = 0.0; }');
      assert.strictEqual(message.buffers.ComputeSubsteps, 'void computeMain(uint3 tid) { laneA[tid.x] = 0.0; }');
    });

    test('does not use the owning image shader when previewing a configured buffer pass', async () => {
      const rootPath = '/test/buffer-workspace.slang';
      const passPath = '/test/passes/buffer-a.slang';
      const configPath = '/test/buffer-workspace.sha.json';
      const config = {
        passes: { BufferA: { path: './passes/buffer-a.slang' } },
      } as any;
      existsSyncStub.callsFake((filePath: string) => ![
        '/test/passes/buffer-a.sha.json',
        '/test/buffer-workspace.glsl',
        '/test/buffer-workspace.frag',
      ].includes(filePath));
      sandbox.stub(vscode.workspace, 'findFiles').resolves([vscode.Uri.file(configPath)]);
      sandbox.stub(vscode.workspace, 'openTextDocument').callsFake((async (filePath: string | vscode.Uri) => ({
        getText: () => (typeof filePath === 'string' ? filePath : filePath.fsPath) === rootPath
          ? 'float4 mainImage(float2 fragCoord) { return float4(0); }'
          : 'float4 mainImage(float2 fragCoord) { return float4(1); }',
      })) as any);
      sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').callsFake((_path: string, buffers: Record<string, string>) => {
        buffers.BufferA = 'float4 mainImage(float2 fragCoord) { return float4(1); }';
        return config;
      });
      sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async (message: any) => message);

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: passPath });

      const message = postMessageSpy.firstCall.args[0];
      assert.strictEqual(message.path, passPath);
      assert.strictEqual(message.previewPath, passPath);
      assert.strictEqual(message.code, 'float4 mainImage(float2 fragCoord) { return float4(1); }');
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
      // ConfigPathConverter.processConfigPaths is now async - stub to pass through
      sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async (msg: any) => msg);

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: '/test/shader.glsl' });

      const message = postMessageSpy.firstCall.args[0];
      assert.deepStrictEqual(message.config, mockConfig);
      assert.deepStrictEqual(message.buffers, mockBuffers);
    });

    test('should evaluate configured scripts in the extension host and send custom uniform metadata', async () => {
      const mockDocument = {
        getText: () => 'void mainImage(out vec4 color, vec2 coord) { color = vec4(uFloat); }'
      };
      const mockConfig = { script: './uniforms.ts' };

      sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
      sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns(mockConfig as any);
      sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async (msg: any) => msg);
      const bundleStub = sandbox.stub(ScriptBundler.prototype, 'bundle').resolves({
        success: true,
        code: 'bundled uniforms',
      });
      const loadScriptStub = sandbox.stub(ScriptEvaluator.prototype, 'loadScript').returns({
        declarations: 'uniform float uFloat;',
        uniforms: [{ name: 'uFloat', type: 'float' }],
      });

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: '/test/shader.glsl' });

      assert.ok(bundleStub.calledOnceWith('/test/uniforms.ts'));
      assert.ok(loadScriptStub.calledOnceWith('bundled uniforms', '/test/uniforms.ts'));
      const message = postMessageSpy.firstCall.args[0];
      assert.strictEqual(message.customUniformDeclarations, 'uniform float uFloat;');
      assert.deepStrictEqual(message.customUniformInfo, [{ name: 'uFloat', type: 'float' }]);
    });

    test('should return a script error without attempting to bundle a missing custom uniform script', async () => {
      const mockDocument = { getText: () => 'void main() {}' };
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
      sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns({
        script: './missing.ts',
      } as any);
      sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async (msg: any) => msg);
      existsSyncStub.withArgs('/test/missing.ts').returns(false);
      const bundleStub = sandbox.stub(ScriptBundler.prototype, 'bundle');

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: '/test/shader.glsl' });

      assert.strictEqual(
        postMessageSpy.firstCall.args[0].scriptBundleError,
        'Script file not found: ./missing.ts',
      );
      assert.ok(bundleStub.notCalled);
    });

    test('should not execute custom uniform scripts in an untrusted workspace', async () => {
      const mockDocument = { getText: () => 'void main() {}' };
      sandbox.stub(vscode.workspace, 'isTrusted').value(false);
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
      sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns({
        script: './uniforms.ts',
      } as any);
      sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async (msg: any) => msg);
      const bundleStub = sandbox.stub(ScriptBundler.prototype, 'bundle');

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: '/test/shader.glsl' });

      assert.strictEqual(
        postMessageSpy.firstCall.args[0].scriptBundleError,
        'Custom uniform scripts are disabled in untrusted workspaces',
      );
      assert.ok(bundleStub.notCalled);
    });

    test('should not execute a custom uniform script outside the shader workspace', async () => {
      const mockDocument = { getText: () => 'void main() {}' };
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
      sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns({
        script: '../outside/uniforms.ts',
      } as any);
      sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async (msg: any) => msg);
      const bundleStub = sandbox.stub(ScriptBundler.prototype, 'bundle');

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: '/test/shader.glsl' });

      assert.strictEqual(
        postMessageSpy.firstCall.args[0].scriptBundleError,
        'Custom uniform script must be inside the shader workspace',
      );
      assert.ok(bundleStub.notCalled);
    });

    test('should bundle unsaved custom uniform script content when its document is open', async () => {
      const shaderDocument = { getText: () => 'void main() {}' };
      const scriptDocument = {
        uri: { fsPath: '/test/uniforms.ts' },
        getText: () => 'export const uniforms = () => ({ uFloat: 0.75 });',
      };
      sandbox.stub(vscode.workspace, 'textDocuments').value([scriptDocument]);
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves(shaderDocument as any);
      sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns({
        script: './uniforms.ts',
      } as any);
      sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async (msg: any) => msg);
      const bundleStub = sandbox.stub(ScriptBundler.prototype, 'bundle').resolves({
        success: true,
        code: 'bundled uniforms',
      });
      sandbox.stub(ScriptEvaluator.prototype, 'loadScript').returns({
        declarations: 'uniform float uFloat;',
        uniforms: [{ name: 'uFloat', type: 'float' }],
      });

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: '/test/shader.glsl' });

      assert.ok(bundleStub.calledOnceWith(
        '/test/uniforms.ts',
        'export const uniforms = () => ({ uFloat: 0.75 });',
      ));
    });

    test('should return script bundling and evaluation errors in the shader response', async () => {
      const mockDocument = { getText: () => 'void main() {}' };
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
      sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns({
        script: './uniforms.ts',
      } as any);
      sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async (msg: any) => msg);
      const bundleStub = sandbox.stub(ScriptBundler.prototype, 'bundle');
      bundleStub.onFirstCall().resolves({ success: false, error: 'bundle failed' });
      bundleStub.onSecondCall().resolves({ success: true, code: 'invalid bundle' });
      sandbox.stub(ScriptEvaluator.prototype, 'loadScript').returns({
        declarations: '',
        uniforms: [],
        error: 'evaluation failed',
      });

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'requestShaderCode', path: '/test/shader.glsl' });
      await messageHandler({ type: 'requestShaderCode', path: '/test/shader.glsl' });

      assert.strictEqual(postMessageSpy.firstCall.args[0].scriptBundleError, 'bundle failed');
      assert.strictEqual(postMessageSpy.secondCall.args[0].scriptBundleError, 'evaluation failed');
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

  suite('Message Handling - searchShaders', () => {
    test('should search shader source text and return matching paths only', async () => {
      const fs = require('fs');
      const firstUri = vscode.Uri.file('/workspace/shaders/noise.glsl');
      const secondUri = vscode.Uri.file('/workspace/shaders/plain.glsl');
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace') },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([firstUri, secondUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 1_000, birthtimeMs: 500 });
      sandbox.stub(fs.promises, 'readFile').callsFake(async (...args: unknown[]) => {
        const filePath = args[0] as string;
        if (filePath === '/workspace/shaders/noise.glsl') {
          return 'float fbm(vec2 p) { return 0.0; }';
        }
        return 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}';
      });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'searchShaders', query: 'fbm', requestId: 7 });

      assert.ok(postMessageSpy.calledOnce);
      const message = postMessageSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderSearchResults');
      assert.strictEqual(message.query, 'fbm');
      assert.strictEqual(message.requestId, 7);
      assert.deepStrictEqual(message.paths, ['/workspace/shaders/noise.glsl']);
      assert.strictEqual(message.shaders, undefined, 'search should not send shader source text to the webview');
    });

    test('should search unsaved open shader document text', async () => {
      const fs = require('fs');
      const shaderUri = vscode.Uri.file('/workspace/shaders/unsaved.glsl');
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace') },
      ]);
      sandbox.stub(vscode.workspace, 'textDocuments').value([
        {
          uri: shaderUri,
          version: 5,
          getText: () => '// #test\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {}',
        },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([shaderUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 1_000, birthtimeMs: 500 });
      const readFileStub = sandbox.stub(fs.promises, 'readFile').resolves(
        'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}',
      );

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'searchShaders', query: '#test', requestId: 9 });

      assert.deepStrictEqual(postMessageSpy.firstCall.args[0].paths, ['/workspace/shaders/unsaved.glsl']);
      assert.strictEqual(readFileStub.callCount, 0, 'open document text should avoid disk reads');
    });

    test('should rank shader name matches before source text matches', async () => {
      const fs = require('fs');
      const titleMatchUri = vscode.Uri.file('/workspace/shaders/noise.glsl');
      const contentMatchUri = vscode.Uri.file('/workspace/shaders/clouds.glsl');
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace') },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([contentMatchUri, titleMatchUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 1_000, birthtimeMs: 500 });
      sandbox.stub(fs.promises, 'readFile').callsFake(async (...args: unknown[]) => {
        const filePath = args[0] as string;
        if (filePath === '/workspace/shaders/clouds.glsl') {
          return 'float noise(vec2 p) { return 0.0; }';
        }
        return 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}';
      });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'searchShaders', query: 'noise', requestId: 8 });

      assert.deepStrictEqual(postMessageSpy.firstCall.args[0].paths, [
        '/workspace/shaders/noise.glsl',
        '/workspace/shaders/clouds.glsl',
      ]);
    });

    test('should require all positive query terms across title path and source text', async () => {
      const fs = require('fs');
      const mixedMatchUri = vscode.Uri.file('/workspace/shaders/ray.glsl');
      const partialTitleUri = vscode.Uri.file('/workspace/shaders/ray-only.glsl');
      const partialSourceUri = vscode.Uri.file('/workspace/shaders/plain.glsl');
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace') },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([partialSourceUri, partialTitleUri, mixedMatchUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 1_000, birthtimeMs: 500 });
      sandbox.stub(fs.promises, 'readFile').callsFake(async (...args: unknown[]) => {
        const filePath = args[0] as string;
        if (filePath === '/workspace/shaders/ray.glsl') {
          return 'float sphereDistance(vec3 p) { return length(p) - 1.0; }';
        }
        if (filePath === '/workspace/shaders/plain.glsl') {
          return 'float sphereDistance(vec3 p) { return length(p) - 1.0; }';
        }
        return 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}';
      });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'searchShaders', query: 'ray sphere', requestId: 10 });

      assert.deepStrictEqual(postMessageSpy.firstCall.args[0].paths, [
        '/workspace/shaders/ray.glsl',
      ]);
    });

    test('should match quoted phrases exactly', async () => {
      const fs = require('fs');
      const phraseUri = vscode.Uri.file('/workspace/shaders/march.glsl');
      const separatedUri = vscode.Uri.file('/workspace/shaders/separated.glsl');
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace') },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([separatedUri, phraseUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 1_000, birthtimeMs: 500 });
      sandbox.stub(fs.promises, 'readFile').callsFake(async (...args: unknown[]) => {
        const filePath = args[0] as string;
        if (filePath === '/workspace/shaders/march.glsl') {
          return 'float ray march(vec3 ro, vec3 rd) { return 0.0; }';
        }
        return 'float rayDistance = 0.0; float marchSteps = 64.0;';
      });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'searchShaders', query: '"ray march"', requestId: 11 });

      assert.deepStrictEqual(postMessageSpy.firstCall.args[0].paths, [
        '/workspace/shaders/march.glsl',
      ]);
    });

    test('should exclude shaders matching negative query terms', async () => {
      const fs = require('fs');
      const imageUri = vscode.Uri.file('/workspace/shaders/noise-image.glsl');
      const bufferUri = vscode.Uri.file('/workspace/shaders/noise-buffer.glsl');
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace') },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([bufferUri, imageUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 1_000, birthtimeMs: 500 });
      sandbox.stub(fs.promises, 'readFile').resolves('float noise(vec2 p) { return 0.0; }');

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'searchShaders', query: 'noise -buffer', requestId: 12 });

      assert.deepStrictEqual(postMessageSpy.firstCall.args[0].paths, [
        '/workspace/shaders/noise-image.glsl',
      ]);
    });

    test('should reuse cached shader text for repeated searches with the same modified time', async () => {
      const fs = require('fs');
      const shaderUri = vscode.Uri.file('/workspace/shaders/cached.glsl');
      const readFileStub = sandbox.stub(fs.promises, 'readFile').resolves(
        'vec3 palette(float t) { return vec3(t); }',
      );
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace') },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([shaderUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 1_000, birthtimeMs: 500 });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'searchShaders', query: 'palette', requestId: 1 });
      await messageHandler({ type: 'searchShaders', query: 'vec3', requestId: 2 });

      assert.strictEqual(readFileStub.callCount, 1);
      assert.deepStrictEqual(postMessageSpy.secondCall.args[0].paths, ['/workspace/shaders/cached.glsl']);
    });

    test('should not post stale results when a newer search starts', async () => {
      const fs = require('fs');
      const shaderUri = vscode.Uri.file('/workspace/shaders/fast.glsl');
      let resolveSlowRead: ((value: string) => void) | undefined;
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace') },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([shaderUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 1_000, birthtimeMs: 500 });
      sandbox.stub(fs.promises, 'readFile').callsFake(async () => {
        return new Promise<string>((resolve) => {
          resolveSlowRead = resolve;
        });
      });

      const messageHandler = setupMessageHandler(mockPanel);
      const staleSearch = messageHandler({ type: 'searchShaders', query: 'slow', requestId: 1 });
      await new Promise(resolve => setImmediate(resolve));
      await messageHandler({ type: 'searchShaders', query: 'fast', requestId: 2 });
      resolveSlowRead?.('float slow = 1.0;');
      await staleSearch;

      assert.strictEqual(postMessageSpy.callCount, 1);
      assert.strictEqual(postMessageSpy.firstCall.args[0].requestId, 2);
      assert.deepStrictEqual(postMessageSpy.firstCall.args[0].paths, ['/workspace/shaders/fast.glsl']);
    });

    test('should skip unreadable shader files without failing the search', async () => {
      const fs = require('fs');
      const readableUri = vscode.Uri.file('/workspace/shaders/readable.glsl');
      const unreadableUri = vscode.Uri.file('/workspace/shaders/unreadable.glsl');
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace') },
      ]);
      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      sandbox.stub(vscode.workspace, 'findFiles').resolves([readableUri, unreadableUri]);
      sandbox.stub(fs, 'statSync').returns({ mtimeMs: 1_000, birthtimeMs: 500 });
      sandbox.stub(fs.promises, 'readFile').callsFake(async (...args: unknown[]) => {
        const filePath = args[0] as string;
        if (filePath === '/workspace/shaders/unreadable.glsl') {
          throw new Error('Permission denied');
        }
        return 'const float bloom = 1.0;';
      });

      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'searchShaders', query: 'bloom', requestId: 3 });

      const message = postMessageSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderSearchResults');
      assert.deepStrictEqual(message.paths, ['/workspace/shaders/readable.glsl']);
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

  suite('Message Handling - activateShader', () => {
    test('should activate shader by delegating to refreshSpecificShaderByPath', async () => {
      const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
      executeCommandStub.withArgs('shader-studio.hasActiveViewer').resolves(true);
      executeCommandStub.withArgs(
        'shader-studio.refreshSpecificShaderByPath',
        '/test/shader.glsl',
        { claimActiveAnalysisContext: true },
      ).resolves();

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'activateShader', path: '/test/shader.glsl' });

      assert.ok(executeCommandStub.calledWith(
        'shader-studio.hasActiveViewer',
      ));
      assert.ok(executeCommandStub.calledWith(
        'shader-studio.refreshSpecificShaderByPath',
        '/test/shader.glsl',
        { claimActiveAnalysisContext: true },
      ));
    });

    test('should open Shader Studio and activate shader when there is no active viewer', async () => {
      const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
      executeCommandStub.withArgs('shader-studio.hasActiveViewer').resolves(false);
      executeCommandStub.withArgs('shader-studio.view').resolves();
      executeCommandStub.withArgs(
        'shader-studio.refreshSpecificShaderByPath',
        '/test/shader.glsl',
        { claimActiveAnalysisContext: true },
      ).resolves();

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'activateShader', path: '/test/shader.glsl' });

      assert.ok(executeCommandStub.calledWith('shader-studio.hasActiveViewer'));
      assert.ok(executeCommandStub.calledWith('shader-studio.view'));
      assert.ok(executeCommandStub.calledWith(
        'shader-studio.refreshSpecificShaderByPath',
        '/test/shader.glsl',
        { claimActiveAnalysisContext: true },
      ));
    });

    test('should show error message if activating shader fails', async () => {
      const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
      executeCommandStub.withArgs('shader-studio.hasActiveViewer').rejects(new Error('Activation failed'));
      const showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'activateShader', path: '/test/shader.glsl' });

      assert.ok(showErrorMessageStub.calledOnce);
      assert.ok(showErrorMessageStub.firstCall.args[0].includes('Failed to activate shader'));
    });
  });

  suite('Message Handling - openConfig', () => {
    test('should open config file on openConfig message', async () => {
      const mockDocument = {} as any;
      const openTextDocumentStub = sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument);
      const showTextDocumentStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'openConfig', path: '/test/shader.sha.json' });

      assert.ok(openTextDocumentStub.calledOnce);
      assert.strictEqual(openTextDocumentStub.firstCall.args[0], '/test/shader.sha.json');
      assert.ok(showTextDocumentStub.calledOnce);
    });

    test('should show error message if opening config fails', async () => {
      sandbox.stub(vscode.workspace, 'openTextDocument').rejects(new Error('Config not found'));
      const showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');

      sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
      const messageHandler = setupMessageHandler(mockPanel);
      await messageHandler({ type: 'openConfig', path: '/test/shader.sha.json' });

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
