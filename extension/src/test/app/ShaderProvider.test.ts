import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ShaderProvider } from '../../app/ShaderProvider';
import { ShaderConfigProcessor } from '../../app/ShaderConfigProcessor';
import { PathResolver } from '../../app/PathResolver';
import { Logger } from '../../app/services/Logger';
import { ConfigChangeClassifier } from '../../app/services/ConfigChangeClassifier';
import { SlangShaderWorkspaceCoordinator, type SlangShaderWorkspaceCoordinatorHost } from '../../app/SlangShaderWorkspaceCoordinator';

suite('ShaderProvider Test Suite', () => {
  let provider: ShaderProvider;
  let mockMessenger: any;
  let sandbox: sinon.SinonSandbox;
  let sendSpy: sinon.SinonSpy;
  let mockOutputChannel: any;
  let loadAndProcessConfigStub: sinon.SinonStub;
  let processConfigStub: sinon.SinonStub;

  setup(() => {
    sandbox = sinon.createSandbox();

    mockOutputChannel = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      dispose: sandbox.stub(),
      appendLine: sandbox.stub(),
      append: sandbox.stub(),
      clear: sandbox.stub(),
      show: sandbox.stub(),
      hide: sandbox.stub(),
      name: 'Test Output',
      replace: sandbox.stub(),
    };

    Logger.initialize(mockOutputChannel);

    sendSpy = sandbox.spy();
    mockMessenger = {
      send: sendSpy,
      hasActiveClients: sandbox.stub().returns(true),
      getErrorHandler: sandbox.stub().returns({
        handleError: sandbox.stub(),
        handlePersistentError: sandbox.stub(),
        clearPersistentErrors: sandbox.stub()
      })
    };

    // Stub prototype methods before creating provider
    loadAndProcessConfigStub = sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig');
    processConfigStub = sandbox.stub(ShaderConfigProcessor.prototype, 'processConfig');

    provider = new ShaderProvider(mockMessenger);
  });

  teardown(() => {
    sandbox.restore();
  });


  suite('sendShaderFromEditor', () => {

    test('should clear persistent errors before processing', async () => {
      const shaderPath = '/path/to/shader.glsl';

      const mockEditor = {
        document: {
          getText: sandbox.stub().returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}'),
          uri: { fsPath: shaderPath },
          languageId: 'glsl',
          lineAt: sandbox.stub().returns({ text: '' })
        },
        selection: { active: { line: 0, character: 0 } }
      };

      loadAndProcessConfigStub.returns(null);

      const clearPersistentErrorsStub = mockMessenger.getErrorHandler().clearPersistentErrors;

      await provider.sendShaderFromEditor(mockEditor as any);

      sinon.assert.calledOnce(clearPersistentErrorsStub);
    });

    test('should send regular shader for non-common buffer GLSL files with mainImage', async () => {
      const shaderPath = '/path/to/shader.glsl';

      const mockEditor = {
        document: {
          getText: sandbox.stub().returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}'),
          uri: { fsPath: shaderPath },
          languageId: 'glsl',
          lineAt: sandbox.stub().returns({ text: 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}' })
        },
        selection: {
          active: {
            line: 0,
            character: 0
          }
        }
      };

      const mockConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      loadAndProcessConfigStub.returns(mockConfig);

      await provider.sendShaderFromEditor(mockEditor as any);

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderSource');
      assert.strictEqual(message.code, 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}');
      assert.strictEqual(message.path, shaderPath);
    });

    test('should include reload in message when option is provided', async () => {
      const shaderPath = '/path/to/shader.glsl';

      const mockEditor = {
        document: {
          getText: sandbox.stub().returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}'),
          uri: { fsPath: shaderPath },
          languageId: 'glsl',
          lineAt: sandbox.stub().returns({ text: 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}' })
        },
        selection: {
          active: {
            line: 0,
            character: 0
          }
        }
      };

      const mockConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      loadAndProcessConfigStub.returns(mockConfig);

      await provider.sendShaderFromEditor(mockEditor as any, { reload: true });

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderSource');
      assert.strictEqual(message.reload, true);
    });

    test('should not include reload when option is not provided', async () => {
      const shaderPath = '/path/to/shader.glsl';

      const mockEditor = {
        document: {
          getText: sandbox.stub().returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}'),
          uri: { fsPath: shaderPath },
          languageId: 'glsl',
          lineAt: sandbox.stub().returns({ text: 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}' })
        },
        selection: {
          active: {
            line: 0,
            character: 0
          }
        }
      };

      const mockConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      loadAndProcessConfigStub.returns(mockConfig);

      await provider.sendShaderFromEditor(mockEditor as any);

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderSource');
      assert.strictEqual(message.reload, undefined);
    });

    test('should NOT include cursor position when debug mode is disabled', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const lineText = 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}';

      const mockEditor = {
        document: {
          getText: sandbox.stub().returns(lineText),
          uri: { fsPath: shaderPath },
          languageId: 'glsl',
          lineAt: sandbox.stub().returns({ text: lineText })
        },
        selection: {
          active: {
            line: 5,
            character: 10
          }
        }
      };

      const mockConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      loadAndProcessConfigStub.returns(mockConfig);

      await provider.sendShaderFromEditor(mockEditor as any);

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderSource');
      assert.strictEqual(message.cursorPosition, undefined, 'cursorPosition should NOT be present when debug is disabled');
    });

    test('should include cursor position when debug mode is enabled', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const lineText = 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}';

      // Create provider with debug mode enabled
      let debugModeEnabled = true;
      const providerWithDebug = new ShaderProvider(mockMessenger, () => debugModeEnabled);

      const mockEditor = {
        document: {
          getText: sandbox.stub().returns(lineText),
          uri: { fsPath: shaderPath },
          languageId: 'glsl',
          lineAt: sandbox.stub().returns({ text: lineText })
        },
        selection: {
          active: {
            line: 5,
            character: 10
          }
        }
      };

      const mockConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      loadAndProcessConfigStub.returns(mockConfig);

      await providerWithDebug.sendShaderFromEditor(mockEditor as any);

      sinon.assert.called(sendSpy);
      const message = sendSpy.lastCall.args[0];
      assert.strictEqual(message.type, 'shaderSource');
      assert.ok(message.cursorPosition, 'cursorPosition should be present when debug is enabled');
      assert.strictEqual(message.cursorPosition.line, 5);
      assert.strictEqual(message.cursorPosition.character, 10);
      assert.strictEqual(message.cursorPosition.lineContent, lineText);
      assert.strictEqual(message.cursorPosition.filePath, shaderPath);
    });

    test('should include cursor position with correct line content when debug is enabled', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const line3Text = '  vec2 uv = fragCoord / iResolution.xy;';

      // Create provider with debug mode enabled
      let debugModeEnabled = true;
      const providerWithDebug = new ShaderProvider(mockMessenger, () => debugModeEnabled);

      const mockEditor = {
        document: {
          getText: sandbox.stub().returns('void mainImage() {...}'),
          uri: { fsPath: shaderPath },
          languageId: 'glsl',
          lineAt: sandbox.stub().returns({ text: line3Text })
        },
        selection: {
          active: {
            line: 3,
            character: 15
          }
        }
      };

      const mockConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      loadAndProcessConfigStub.returns(mockConfig);

      await providerWithDebug.sendShaderFromEditor(mockEditor as any);

      sinon.assert.called(sendSpy);
      const message = sendSpy.lastCall.args[0];
      assert.strictEqual(message.cursorPosition.line, 3);
      assert.strictEqual(message.cursorPosition.lineContent, line3Text);
    });

    test('should send error to UI for GLSL files without mainImage', () => {
      const shaderPath = '/path/to/shader.glsl';

      const mockEditor = {
        document: {
          getText: sandbox.stub().returns('void someFunction() {}'),
          uri: { fsPath: shaderPath },
          languageId: 'glsl'
        }
      };

      provider.sendShaderFromEditor(mockEditor as any);

      sinon.assert.calledOnce(sendSpy);
      sinon.assert.calledWith(sendSpy, {
        type: 'error',
        payload: ['Missing mainImage function']
      });
    });

    test('should send error for standalone common editor files without mainImage', async () => {
      const shaderPath = '/path/to/shader.common.glsl';
      const mockEditor = {
        document: {
          getText: sandbox.stub().returns('float helper() { return 1.0; }'),
          uri: { fsPath: shaderPath },
          languageId: 'glsl'
        },
      };

      await provider.sendShaderFromEditor(mockEditor as any);

      sinon.assert.calledOnce(sendSpy);
      sinon.assert.calledWith(sendSpy, {
        type: 'error',
        payload: ['Missing mainImage function']
      });
    });

    test('should not show VS Code warning for GLSL files without mainImage', () => {
      const shaderPath = '/path/to/shader.glsl';

      const mockEditor = {
        document: {
          getText: sandbox.stub().returns('void someFunction() {}'),
          uri: { fsPath: shaderPath },
          languageId: 'glsl'
        }
      };

      const showWarningStub = sandbox.stub(vscode.window, 'showWarningMessage');

      provider.sendShaderFromEditor(mockEditor as any);

      sinon.assert.notCalled(showWarningStub);
    });
  });

  suite('buildBufferPathMap', () => {
    let resolvePathStub: sinon.SinonStub;

    setup(() => {
      resolvePathStub = sandbox.stub(PathResolver, 'resolvePath');
      resolvePathStub.callsFake((_shaderPath: string, targetPath: string) => {
        return `/resolved/${targetPath}`;
      });
    });

    test('should map Image to shaderPath', () => {
      const result = (provider as any).buildBufferPathMap(null, '/path/to/shader.glsl');
      assert.strictEqual(result.Image, '/path/to/shader.glsl');
    });

    test('should map BufferA-D to resolved absolute paths', () => {
      const config = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
          BufferB: { path: 'bufferB.glsl', inputs: {} },
        }
      };

      const result = (provider as any).buildBufferPathMap(config, '/path/to/shader.glsl');
      assert.strictEqual(result.Image, '/path/to/shader.glsl');
      assert.strictEqual(result.BufferA, '/resolved/bufferA.glsl');
      assert.strictEqual(result.BufferB, '/resolved/bufferB.glsl');
    });

    test('should handle common buffer', () => {
      const config = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          common: { path: 'common.glsl', inputs: {} },
        }
      };

      const result = (provider as any).buildBufferPathMap(config, '/path/to/shader.glsl');
      assert.strictEqual(result.common, '/resolved/common.glsl');
    });

    test('should skip buffers without paths', () => {
      const config = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { inputs: {} },
        }
      };

      const result = (provider as any).buildBufferPathMap(config, '/path/to/shader.glsl');
      assert.strictEqual(result.Image, '/path/to/shader.glsl');
      assert.strictEqual(result.BufferA, undefined);
    });

    test('should return only Image when config is null', () => {
      const result = (provider as any).buildBufferPathMap(null, '/path/to/shader.glsl');
      assert.deepStrictEqual(Object.keys(result), ['Image']);
      assert.strictEqual(result.Image, '/path/to/shader.glsl');
    });
  });

  suite('sendShaderFromPath', () => {
    test('should clear persistent errors before processing', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const fs = require('fs');

      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}');
      loadAndProcessConfigStub.returns(null);

      const clearPersistentErrorsStub = mockMessenger.getErrorHandler().clearPersistentErrors;

      await provider.sendShaderFromPath(shaderPath);

      sinon.assert.calledOnce(clearPersistentErrorsStub);
    });

    test('should include reload in message when option is provided', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const fs = require('fs');

      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}');

      const mockConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      loadAndProcessConfigStub.returns(mockConfig);

      await provider.sendShaderFromPath(shaderPath, { reload: true });

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderSource');
      assert.strictEqual(message.reload, true);
      assert.strictEqual(message.path, shaderPath);
    });

    test('should not include reload when option is not provided', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const fs = require('fs');

      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}');

      const mockConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      loadAndProcessConfigStub.returns(mockConfig);

      await provider.sendShaderFromPath(shaderPath);

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderSource');
      assert.strictEqual(message.reload, undefined);
    });

    test('should send error to UI for files without mainImage', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const fs = require('fs');

      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').returns('void someFunction() {}');

      await provider.sendShaderFromPath(shaderPath);

      sinon.assert.calledOnce(sendSpy);
      sinon.assert.calledWith(sendSpy, {
        type: 'error',
        payload: ['Missing mainImage function']
      });
    });

    test('should send error for standalone common paths without mainImage', async () => {
      const shaderPath = '/path/to/shader.common.glsl';
      const fs = require('fs');

      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync')
        .withArgs(shaderPath, 'utf-8').returns('float helper() { return 1.0; }');

      await provider.sendShaderFromPath(shaderPath);

      sinon.assert.calledOnce(sendSpy);
      sinon.assert.calledWith(sendSpy, {
        type: 'error',
        payload: ['Missing mainImage function']
      });
    });

    test('should not show VS Code warning for files without mainImage', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const fs = require('fs');

      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').returns('void someFunction() {}');

      const showWarningStub = sandbox.stub(vscode.window, 'showWarningMessage');

      await provider.sendShaderFromPath(shaderPath);

      sinon.assert.notCalled(showWarningStub);
    });
  });

  suite('sendShaderFromDocument', () => {
    test('should clear persistent errors before processing', async () => {
      const document = {
        getText: sandbox.stub().returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}'),
        uri: vscode.Uri.file('/path/to/shader.glsl'),
        languageId: 'glsl',
      } as any;
      loadAndProcessConfigStub.returns(null);

      const clearPersistentErrorsStub = mockMessenger.getErrorHandler().clearPersistentErrors;

      await provider.sendShaderFromDocument(document);

      sinon.assert.calledOnce(clearPersistentErrorsStub);
    });

    test('should send regular shader messages from an in-memory GLSL document', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const document = {
        getText: sandbox.stub().returns('void mainImage(out vec4 fragColor, in vec2 fragCoord) {}'),
        uri: vscode.Uri.file(shaderPath),
        languageId: 'glsl',
      } as any;

      loadAndProcessConfigStub.returns({
        version: '1.0',
        passes: { Image: {} },
      });

      await provider.sendShaderFromDocument(document, { reload: true });

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderSource');
      assert.strictEqual(message.path, shaderPath);
      assert.strictEqual(message.code, 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}');
      assert.strictEqual(message.reload, true);
    });

    test('should include cursor position from the matching visible editor when debug mode is enabled', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const lineText = '  vec2 uv = fragCoord / iResolution.xy;';
      const providerWithDebug = new ShaderProvider(mockMessenger, () => true);
      const document = {
        getText: sandbox.stub().returns('void mainImage() {}'),
        uri: vscode.Uri.file(shaderPath),
        languageId: 'glsl',
        lineCount: 10,
        lineAt: sandbox.stub().withArgs(3).returns({ text: lineText }),
      } as any;

      sandbox.stub(vscode.window, 'visibleTextEditors').value([{
        document: { uri: vscode.Uri.file(shaderPath) },
        selection: {
          active: { line: 3, character: 12 },
        },
      } as any]);

      loadAndProcessConfigStub.returns({
        version: '1.0',
        passes: { Image: {} },
      });

      await providerWithDebug.sendShaderFromDocument(document);

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.deepStrictEqual(message.cursorPosition, {
        line: 3,
        character: 12,
        lineContent: lineText,
        filePath: shaderPath,
      });
    });

    test('should not throw when cursor line exceeds new document line count (paste-shorter-shader)', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const newCode = 'void mainImage(out vec4 o, vec2 u) { o = vec4(1.0); }';
      const providerWithDebug = new ShaderProvider(mockMessenger, () => true);

      // Document now has only 1 line after paste, but cursor was on line 50 in the old doc
      const document = {
        getText: sandbox.stub().returns(newCode),
        uri: vscode.Uri.file(shaderPath),
        languageId: 'glsl',
        lineCount: 1,
        lineAt: sandbox.stub().withArgs(0).returns({ text: newCode }),
      } as any;

      sandbox.stub(vscode.window, 'visibleTextEditors').value([{
        document: { uri: vscode.Uri.file(shaderPath) },
        selection: { active: { line: 50, character: 0 } },
      } as any]);

      loadAndProcessConfigStub.returns({ version: '1.0', passes: { Image: {} } });

      await assert.doesNotReject(() => providerWithDebug.sendShaderFromDocument(document));

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderSource');
      // Cursor clamped to last valid line (0)
      assert.strictEqual(message.cursorPosition?.line, 0);
    });

    test('should send error for standalone common documents without mainImage', async () => {
      const shaderPath = '/path/to/shader.common.glsl';
      const document = {
        getText: sandbox.stub().returns('float helper() { return 1.0; }'),
        uri: vscode.Uri.file(shaderPath),
        languageId: 'glsl',
      } as any;

      await provider.sendShaderFromDocument(document);

      sinon.assert.calledOnce(sendSpy);
      sinon.assert.calledWith(sendSpy, {
        type: 'error',
        payload: ['Missing mainImage function']
      });
    });

    test('should ignore non-GLSL documents', async () => {
      const document = {
        getText: sandbox.stub().returns('console.log("hi")'),
        uri: vscode.Uri.file('/path/to/file.txt'),
        languageId: 'plaintext',
        fileName: '/path/to/file.txt',
      } as any;

      await provider.sendShaderFromDocument(document);

      sinon.assert.notCalled(sendSpy);
    });
  });

  suite('Slang workspace generations', () => {
    function workspaceHost(files: Record<string, string>, overlay?: { uri: string; source: string }): SlangShaderWorkspaceCoordinatorHost {
      return {
        toUri: (filePath) => `file://${filePath}`,
        toPath: (uri) => new URL(uri).pathname,
        async findSlangFiles() {
          return Object.keys(files);
        },
        async readFile(uri) {
          return files[uri];
        },
        get openDocuments() {
          return overlay ? [{ ...overlay, version: 1 }] : [];
        },
      };
    }

    test('attaches a single-root Slang workspace transaction while leaving GLSL transaction fields absent', async () => {
      const files = { 'file:///work/image.slang': 'void mainImage() {}' };
      const coordinator = new SlangShaderWorkspaceCoordinator(workspaceHost(files));
      provider = new ShaderProvider(mockMessenger, undefined, new ConfigChangeClassifier(), coordinator, 'panel:1');
      loadAndProcessConfigStub.returns(null);
      await provider.sendShaderFromDocument({
        fileName: '/work/image.slang', languageId: 'slang', uri: { fsPath: '/work/image.slang' }, getText: () => 'void mainImage() {}', lineCount: 1,
      } as any);
      const slang = sendSpy.firstCall.args[0];
      assert.ok(slang.workspace);
      assert.strictEqual(slang.requestId, slang.compileGeneration.id);
      assert.deepStrictEqual([slang.compileGeneration.rootIndex, slang.compileGeneration.rootCount], [0, 1]);
      assert.deepStrictEqual(slang.compileScope.rootUris, [slang.workspace.rootUri]);
      assert.strictEqual(slang.compileScope.ownerId, 'panel:1');
      sendSpy.resetHistory();
      await provider.sendShaderFromDocument({
        fileName: '/work/image.glsl', languageId: 'glsl', uri: { fsPath: '/work/image.glsl' }, getText: () => 'void mainImage() {}', lineCount: 1,
      } as any);
      const glsl = sendSpy.firstCall.args[0];
      assert.strictEqual(glsl.workspace, undefined);
      assert.strictEqual(glsl.requestId, undefined);
      assert.strictEqual(glsl.compileGeneration, undefined);
      assert.strictEqual(glsl.compileScope, undefined);
    });

    test('routes a helper edit as one deterministic Slang generation without a missing-entry error', async () => {
      const files = {
        'file:///work/a.slang': '#include "lib.slang"\nvoid mainImage() {}',
        'file:///work/b.slang': '#include "lib.slang"\nvoid mainImage() {}',
        'file:///work/lib.slang': 'float disk;',
      };
      const coordinator = new SlangShaderWorkspaceCoordinator(workspaceHost(files, {
        uri: 'file:///work/lib.slang', source: 'float unsaved;',
      }));
      const [a, b] = await coordinator.prepareRoots([
        { rootPath: '/work/a.slang', configuredFilePaths: [] }, { rootPath: '/work/b.slang', configuredFilePaths: [] },
      ]);
      coordinator.commitOwnerRequest(coordinator.beginOwnerRequest('shader-provider', '/work/a.slang'), a);
      coordinator.commitOwnerRequest(coordinator.beginOwnerRequest('other-panel', '/work/b.slang'), b);
      provider = new ShaderProvider(mockMessenger, undefined, new ConfigChangeClassifier(), coordinator);
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').callsFake((filePath: unknown) => files[`file://${String(filePath)}` as keyof typeof files] ?? '');
      loadAndProcessConfigStub.returns(null);

      await provider.sendShaderFromDocument({
        fileName: '/work/lib.slang', languageId: 'slang', uri: { fsPath: '/work/lib.slang' }, getText: () => 'float unsaved;',
      } as any);

      assert.strictEqual(sendSpy.callCount, 2);
      const messages = sendSpy.getCalls().map((call) => call.args[0]);
      assert.deepStrictEqual(messages.map((message) => message.path), ['/work/a.slang', '/work/b.slang']);
      assert.strictEqual(messages[0].requestId, messages[1].requestId);
      assert.deepStrictEqual(messages.map((message) => [message.compileGeneration.rootIndex, message.compileGeneration.rootCount]), [[0, 2], [1, 2]]);
      assert.deepStrictEqual(messages[0].compileScope.rootUris, messages[1].compileScope.rootUris);
      assert.strictEqual(messages[0].workspace.files.find((file: { path: string }) => file.path === '/workspace/lib.slang').source, 'float unsaved;');

      await provider.sendShaderFromDocument({
        fileName: '/work/lib.slang', languageId: 'slang', uri: { fsPath: '/work/lib.slang' }, getText: () => 'float unsaved;',
      } as any);
      assert.strictEqual(sendSpy.callCount, 2, 'an identical hot/save dependency snapshot is not re-sent');
    });

    test('does not send or commit an obsolete prepared helper generation', async () => {
      const files = {
        'file:///work/a.slang': '#include "lib.slang"\nvoid mainImage() {}',
        'file:///work/b.slang': '#include "lib.slang"\nvoid mainImage() {}',
        'file:///work/lib.slang': 'float disk;',
      };
      const coordinator = new SlangShaderWorkspaceCoordinator(workspaceHost(files));
      const [a, b] = await coordinator.prepareRoots([
        { rootPath: '/work/a.slang', configuredFilePaths: [] }, { rootPath: '/work/b.slang', configuredFilePaths: [] },
      ]);
      coordinator.commitOwnerRequest(coordinator.beginOwnerRequest('shader-provider', '/work/a.slang'), a);
      coordinator.commitOwnerRequest(coordinator.beginOwnerRequest('other-panel', '/work/b.slang'), b);
      provider = new ShaderProvider(mockMessenger, undefined, new ConfigChangeClassifier(), coordinator);
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').callsFake((filePath: unknown) => files[`file://${String(filePath)}` as keyof typeof files] ?? '');
      loadAndProcessConfigStub.returns(null);
      let releaseBundle: (() => void) | undefined;
      sandbox.stub(provider as any, 'bundleScript').callsFake(async () => new Promise<void>((resolve) => {
        releaseBundle = resolve;
      }));

      const pending = provider.sendShaderFromDocument({
        fileName: '/work/lib.slang', languageId: 'slang', uri: { fsPath: '/work/lib.slang' }, getText: () => 'float changed;',
      } as any);
      await new Promise((resolve) => setImmediate(resolve));
      coordinator.beginOwnerRequest('shader-provider', '/work/a.slang');
      releaseBundle!();
      await pending;

      sinon.assert.notCalled(sendSpy);
    });
  });

  suite('config change classifier snapshot recording', () => {
    test('records the raw config file text (not the reprocessed config) on send', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const configPath = '/path/to/shader.sha.json';
      const fs = require('fs');
      const shaderCode = 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}';
      // Deliberately irregular whitespace/formatting so a re-serialized
      // JSON.stringify() of the processed config would NOT match this string —
      // proves the classifier is fed the raw file text, not derived JSON.
      const rawConfigText = '{\n  "version":   "1.0",\n\n  "passes": {   "Image": {} }\n}\n\n';

      sandbox.stub(fs, 'existsSync').returns(true);
      const readStub = sandbox.stub(fs, 'readFileSync');
      readStub.withArgs(shaderPath, 'utf-8').returns(shaderCode);
      readStub.withArgs(configPath, 'utf-8').returns(rawConfigText);

      const mockConfig = { version: '1.0', passes: { Image: {} } };
      loadAndProcessConfigStub.returns(mockConfig);

      const classifier = new ConfigChangeClassifier();
      const recordSpy = sandbox.spy(classifier, 'recordSentConfig');
      const providerWithClassifier = new ShaderProvider(mockMessenger, undefined, classifier);

      await providerWithClassifier.sendShaderFromPath(shaderPath);

      sinon.assert.calledOnce(sendSpy);
      sinon.assert.calledOnce(recordSpy);
      sinon.assert.calledWithExactly(recordSpy, configPath, rawConfigText);
      assert.notStrictEqual(recordSpy.firstCall.args[1], JSON.stringify(mockConfig));
    });

    test('records null when the config file cannot be read', async () => {
      const shaderPath = '/path/to/shader-missing-config.glsl';
      const configPath = '/path/to/shader-missing-config.sha.json';
      const fs = require('fs');
      const shaderCode = 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}';

      sandbox.stub(fs, 'existsSync').returns(true);
      const readStub = sandbox.stub(fs, 'readFileSync');
      readStub.withArgs(shaderPath, 'utf-8').returns(shaderCode);
      readStub.withArgs(configPath, 'utf-8').throws(
        Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
      );

      loadAndProcessConfigStub.returns(null);

      const classifier = new ConfigChangeClassifier();
      const recordSpy = sandbox.spy(classifier, 'recordSentConfig');
      const providerWithClassifier = new ShaderProvider(mockMessenger, undefined, classifier);

      await providerWithClassifier.sendShaderFromPath(shaderPath);

      sinon.assert.calledOnce(sendSpy);
      sinon.assert.calledOnce(recordSpy);
      sinon.assert.calledWithExactly(recordSpy, configPath, null);
    });
  });
});
