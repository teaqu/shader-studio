import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ShaderProvider } from '../../app/ShaderProvider';
import { ShaderConfigProcessor } from '../../app/ShaderConfigProcessor';
import { PathResolver } from '../../app/PathResolver';
import { Logger } from '../../app/services/Logger';
import { ConfigChangeClassifier } from '../../app/services/ConfigChangeClassifier';

suite('ShaderProvider Test Suite', () => {
  let provider: ShaderProvider;
  let mockMessenger: any;
  let sandbox: sinon.SinonSandbox;
  let sendSpy: sinon.SinonSpy;
  let mockOutputChannel: any;
  let loadAndProcessConfigStub: sinon.SinonStub;
  let processConfigStub: sinon.SinonStub;
  let onPreamblePreparation: sinon.SinonStub;

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

    onPreamblePreparation = sandbox.stub();
    provider = new ShaderProvider(
      mockMessenger,
      undefined,
      new ConfigChangeClassifier(),
      onPreamblePreparation,
    );
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

    test('should map configured buffer names to resolved absolute paths', () => {
      const config = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
          BlurPass: { path: 'blur.glsl', inputs: {} },
        }
      };

      const result = (provider as any).buildBufferPathMap(config, '/path/to/shader.glsl');
      assert.strictEqual(result.Image, '/path/to/shader.glsl');
      assert.strictEqual(result.BufferA, '/resolved/bufferA.glsl');
      assert.strictEqual(result.BlurPass, '/resolved/blur.glsl');
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

  suite('preamble preparation', () => {
    const mainImageCode = 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {}';

    function editorFor(filePath: string, code: string, languageId = 'glsl'): vscode.TextEditor {
      return {
        document: {
          getText: sandbox.stub().returns(code),
          uri: vscode.Uri.file(filePath),
          languageId,
          fileName: filePath,
          lineAt: sandbox.stub().returns({ text: code }),
        },
        selection: { active: { line: 0, character: 0 } },
      } as any;
    }

    function stubSuccessfulScript(declarations: string): sinon.SinonStub {
      sandbox.stub((provider as any).scriptBundler, 'bundle').resolves({
        success: true,
        code: 'bundled script',
      });
      return sandbox.stub((provider as any).scriptEvaluator, 'loadScript').returns({
        declarations,
        uniforms: [],
      });
    }

    test('emits the active Image inputs, paths, and evaluated custom declarations', async () => {
      const shaderPath = '/workspace/shader.glsl';
      const configPath = '/workspace/shader.sha.json';
      const inputs = {
        iChannel0: { type: 'texture', path: './noise.png' },
      };
      const config = {
        version: '1.0',
        script: './uniforms.ts',
        passes: { Image: { inputs } },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').withArgs(configPath, 'utf-8').returns('{}');
      loadAndProcessConfigStub.returns(config);
      stubSuccessfulScript('uniform float exposure;');

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));

      sinon.assert.calledOnceWithExactly(onPreamblePreparation, {
        kind: 'valid',
        snapshot: {
          shaderPath,
          configPath,
          passName: 'Image',
          inputs,
          customUniformDeclarations: 'uniform float exposure;',
        },
      });
      assert.strictEqual(sendSpy.firstCall.args[0].customUniformDeclarations, 'uniform float exposure;');
    });

    test('emits an owned Buffer pass with root paths, pass inputs, and cached declarations', async () => {
      const shaderPath = '/workspace/shader.glsl';
      const bufferPath = '/workspace/buffer-a.glsl';
      const inputs = {
        history: { type: 'buffer', source: 'BufferA' },
      };
      const config = {
        version: '1.0',
        script: './uniforms.ts',
        passes: {
          Image: {},
          BufferA: { path: './buffer-a.glsl', inputs },
        },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').returns('{}');
      loadAndProcessConfigStub.returns(config);
      const loadScript = stubSuccessfulScript('uniform vec3 tint;');

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));
      onPreamblePreparation.resetHistory();
      await provider.sendShaderFromEditor(editorFor(bufferPath, 'void renderBuffer() {}'));

      sinon.assert.calledOnceWithExactly(onPreamblePreparation, {
        kind: 'valid',
        snapshot: {
          shaderPath,
          configPath: '/workspace/shader.sha.json',
          passName: 'BufferA',
          inputs,
          customUniformDeclarations: 'uniform vec3 tint;',
        },
      });
      sinon.assert.calledOnce(loadScript);
      assert.strictEqual(sendSpy.lastCall.args[0].path, bufferPath);
      assert.strictEqual(sendSpy.lastCall.args[0].config, null);
    });

    test('emits an owned common pass and its inputs', async () => {
      const shaderPath = '/workspace/shader.glsl';
      const commonPath = '/workspace/common.glsl';
      const inputs = {
        iChannel2: { type: 'keyboard' },
      };
      const config = {
        version: '1.0',
        passes: {
          Image: {},
          common: { path: './common.glsl', inputs },
        },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').returns('{}');
      loadAndProcessConfigStub.returns(config);

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));
      onPreamblePreparation.resetHistory();
      await provider.sendShaderFromDocument({
        ...editorFor(commonPath, 'float helper() { return 1.0; }').document,
        lineCount: 1,
      });

      sinon.assert.calledOnceWithExactly(onPreamblePreparation, {
        kind: 'valid',
        snapshot: {
          shaderPath,
          configPath: '/workspace/shader.sha.json',
          passName: 'common',
          inputs,
          customUniformDeclarations: '',
        },
      });
    });

    test('preserves cubemap and custom-alias inputs unchanged in the snapshot', async () => {
      const shaderPath = '/workspace/aliases.glsl';
      const inputs = {
        sky: { type: 'cubemap', path: './sky.png', vflip: true },
        feedbackAlias: { type: 'buffer', source: 'BufferA' },
      };
      const config = {
        version: '1.0',
        passes: { Image: { inputs } },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').returns('{}');
      loadAndProcessConfigStub.returns(config);

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));

      assert.deepStrictEqual(onPreamblePreparation.firstCall.args[0].snapshot.inputs, inputs);
    });

    test('treats a missing config as a valid stable Image snapshot', async () => {
      const shaderPath = '/workspace/no-config.glsl';
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      loadAndProcessConfigStub.returns(null);

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));

      sinon.assert.calledOnceWithExactly(onPreamblePreparation, {
        kind: 'valid',
        snapshot: {
          shaderPath,
          configPath: null,
          passName: 'Image',
          inputs: undefined,
          customUniformDeclarations: '',
        },
      });
    });

    test('emits invalid when an existing config cannot be parsed', async () => {
      const shaderPath = '/workspace/malformed.glsl';
      const configPath = '/workspace/malformed.sha.json';
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').withArgs(configPath).returns(true);
      sandbox.stub(fs, 'readFileSync').throws(new Error('malformed config'));
      loadAndProcessConfigStub.returns(null);

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));

      sinon.assert.calledOnceWithExactly(onPreamblePreparation, {
        kind: 'invalid',
        shaderPath,
      });
    });

    test('emits invalid when the active common pass owning config becomes malformed', async () => {
      const shaderPath = '/workspace/malformed-owner.glsl';
      const commonPath = '/workspace/malformed-owner-common.glsl';
      const config = {
        version: '1.0',
        passes: {
          Image: {},
          common: { path: './malformed-owner-common.glsl' },
        },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const readFile = sandbox.stub(fs, 'readFileSync');
      readFile.withArgs(shaderPath, 'utf-8').returns(mainImageCode);
      readFile.returns('{}');
      loadAndProcessConfigStub.returns(config);

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));
      await provider.sendShaderFromEditor(editorFor(commonPath, 'float helper() { return 1.0; }'));
      onPreamblePreparation.resetHistory();
      loadAndProcessConfigStub.returns(null);

      await provider.sendShaderFromPath(shaderPath);

      sinon.assert.calledOnceWithExactly(onPreamblePreparation, {
        kind: 'invalid',
        shaderPath,
      });
    });

    test('retains successful declarations when the active Buffer owning config becomes malformed', async () => {
      const shaderPath = '/workspace/malformed-cache.glsl';
      const bufferPath = '/workspace/malformed-cache-buffer.glsl';
      const config = {
        version: '1.0',
        script: './uniforms.ts',
        passes: {
          Image: {},
          BufferA: { path: './malformed-cache-buffer.glsl' },
        },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const readFile = sandbox.stub(fs, 'readFileSync');
      readFile.withArgs(shaderPath, 'utf-8').returns(mainImageCode);
      readFile.returns('{}');
      loadAndProcessConfigStub.returns(config);
      sandbox.stub((provider as any).scriptBundler, 'bundle').resolves({
        success: true,
        code: 'bundled script',
      });
      const loadScript = sandbox.stub((provider as any).scriptEvaluator, 'loadScript').returns({
        declarations: 'uniform float retained;',
        uniforms: [],
      });

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));
      await provider.sendShaderFromEditor(editorFor(bufferPath, 'void renderBuffer() {}'));
      loadAndProcessConfigStub.returns(null);
      await provider.sendShaderFromPath(shaderPath);
      onPreamblePreparation.resetHistory();
      loadAndProcessConfigStub.returns(config);

      await provider.sendShaderFromEditor(editorFor(bufferPath, 'void renderBuffer() {}'));

      sinon.assert.calledOnce(onPreamblePreparation);
      assert.strictEqual(
        onPreamblePreparation.firstCall.args[0].snapshot.customUniformDeclarations,
        'uniform float retained;',
      );
      sinon.assert.calledOnce(loadScript);
    });

    for (const failure of ['bundle', 'evaluation'] as const) {
      test(`emits invalid without partial declarations after ${failure} failure`, async () => {
        const shaderPath = `/workspace/${failure}-failure.glsl`;
        const config = {
          version: '1.0',
          script: './uniforms.ts',
          passes: { Image: {} },
        };
        const fs = require('fs');
        sandbox.stub(fs, 'existsSync').returns(true);
        sandbox.stub(fs, 'readFileSync').returns('{}');
        loadAndProcessConfigStub.returns(config);
        const bundle = sandbox.stub((provider as any).scriptBundler, 'bundle');
        const loadScript = sandbox.stub((provider as any).scriptEvaluator, 'loadScript');
        if (failure === 'bundle') {
          bundle.resolves({ success: false, error: 'bundle failed' });
        } else {
          bundle.resolves({ success: true, code: 'bundled script' });
          loadScript.returns({
            declarations: 'uniform float partial;',
            uniforms: [],
            error: 'evaluation failed',
          });
        }

        await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));

        sinon.assert.calledOnceWithExactly(onPreamblePreparation, {
          kind: 'invalid',
          shaderPath,
        });
        assert.strictEqual(sendSpy.firstCall.args[0].customUniformDeclarations, undefined);
        if (failure === 'bundle') {
          sinon.assert.notCalled(loadScript);
        } else {
          sinon.assert.calledOnce(loadScript);
        }
      });
    }

    test('keeps the last successful declaration cache when a later evaluation fails', async () => {
      const shaderPath = '/workspace/cached.glsl';
      const bufferPath = '/workspace/cached-buffer.glsl';
      const config = {
        version: '1.0',
        script: './uniforms.ts',
        passes: {
          Image: {},
          BufferA: { path: './cached-buffer.glsl' },
        },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const readFile = sandbox.stub(fs, 'readFileSync');
      readFile.withArgs(shaderPath, 'utf-8').returns(mainImageCode);
      readFile.returns('{}');
      loadAndProcessConfigStub.returns(config);
      sandbox.stub((provider as any).scriptBundler, 'bundle').resolves({
        success: true,
        code: 'bundled script',
      });
      const loadScript = sandbox.stub((provider as any).scriptEvaluator, 'loadScript');
      loadScript.onFirstCall().returns({
        declarations: 'uniform float retained;',
        uniforms: [],
      });
      loadScript.onSecondCall().returns({
        declarations: 'uniform float partial;',
        uniforms: [],
        error: 'evaluation failed',
      });

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));
      await provider.sendShaderFromPath(shaderPath);
      onPreamblePreparation.resetHistory();
      await provider.sendShaderFromEditor(editorFor(bufferPath, 'void renderBuffer() {}'));

      assert.strictEqual(
        onPreamblePreparation.firstCall.args[0].snapshot.customUniformDeclarations,
        'uniform float retained;',
      );
    });

    test('publishes updated declarations from a successful in-memory script edit', async () => {
      const shaderPath = '/workspace/script-edit.glsl';
      const config = {
        version: '1.0',
        script: './uniforms.ts',
        passes: { Image: {} },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const readFile = sandbox.stub(fs, 'readFileSync');
      readFile.withArgs(shaderPath, 'utf-8').returns(mainImageCode);
      readFile.returns('{}');
      loadAndProcessConfigStub.returns(config);
      sandbox.stub((provider as any).scriptBundler, 'bundle').resolves({
        success: true,
        code: 'bundled script',
      });
      const loadScript = sandbox.stub((provider as any).scriptEvaluator, 'loadScript');
      loadScript.onFirstCall().returns({ declarations: 'uniform float before;', uniforms: [] });
      loadScript.onSecondCall().returns({ declarations: 'uniform float after;', uniforms: [] });

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));
      onPreamblePreparation.resetHistory();
      await provider.sendShaderWithScriptContent(shaderPath, 'export function uniforms() {}');

      assert.strictEqual(
        onPreamblePreparation.firstCall.args[0].snapshot.customUniformDeclarations,
        'uniform float after;',
      );
      sinon.assert.calledTwice(loadScript);
      assert.strictEqual(sendSpy.lastCall.args[0].customUniformDeclarations, 'uniform float after;');
    });

    test('does not emit preamble preparation for Slang source', async () => {
      const shaderPath = '/workspace/shader.slang';
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      loadAndProcessConfigStub.returns(null);

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode, 'slang'));

      sinon.assert.notCalled(onPreamblePreparation);
      assert.strictEqual(sendSpy.firstCall.args[0].language, 'slang');
    });

    test('keeps the active Buffer pass when a Slang editor becomes active', async () => {
      const shaderPath = '/workspace/glsl-root.glsl';
      const bufferPath = '/workspace/glsl-buffer.glsl';
      const slangPath = '/workspace/other.slang';
      const config = {
        version: '1.0',
        passes: {
          Image: {},
          BufferA: { path: './glsl-buffer.glsl' },
        },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const readFile = sandbox.stub(fs, 'readFileSync');
      readFile.withArgs(shaderPath, 'utf-8').returns(mainImageCode);
      readFile.returns('{}');
      loadAndProcessConfigStub.returns(config);

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));
      await provider.sendShaderFromEditor(editorFor(bufferPath, 'void renderBuffer() {}'));
      await provider.sendShaderFromEditor(editorFor(slangPath, mainImageCode, 'slang'));
      onPreamblePreparation.resetHistory();
      await provider.sendShaderFromPath(shaderPath);

      sinon.assert.calledOnce(onPreamblePreparation);
      assert.strictEqual(onPreamblePreparation.firstCall.args[0].snapshot.passName, 'BufferA');
    });

    test('re-emits the active Buffer pass when its root config refreshes', async () => {
      const shaderPath = '/workspace/config-refresh.glsl';
      const bufferPath = '/workspace/config-buffer.glsl';
      const inputs = { source: { type: 'texture', path: './source.png' } };
      const config = {
        version: '1.0',
        passes: {
          Image: {},
          BufferA: { path: './config-buffer.glsl', inputs },
        },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const readFile = sandbox.stub(fs, 'readFileSync');
      readFile.withArgs(shaderPath, 'utf-8').returns(mainImageCode);
      readFile.returns('{}');
      loadAndProcessConfigStub.returns(config);

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));
      await provider.sendShaderFromEditor(editorFor(bufferPath, 'void renderBuffer() {}'));
      onPreamblePreparation.resetHistory();
      await provider.sendShaderFromPath(shaderPath);

      sinon.assert.calledOnce(onPreamblePreparation);
      assert.deepStrictEqual(onPreamblePreparation.firstCall.args[0].snapshot, {
        shaderPath,
        configPath: '/workspace/config-refresh.sha.json',
        passName: 'BufferA',
        inputs,
        customUniformDeclarations: '',
      });
    });

    test('re-emits the active common pass when its root script refreshes', async () => {
      const shaderPath = '/workspace/script-refresh.glsl';
      const commonPath = '/workspace/script-common.glsl';
      const inputs = { keys: { type: 'keyboard' } };
      const config = {
        version: '1.0',
        script: './uniforms.ts',
        passes: {
          Image: {},
          common: { path: './script-common.glsl', inputs },
        },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const readFile = sandbox.stub(fs, 'readFileSync');
      readFile.withArgs(shaderPath, 'utf-8').returns(mainImageCode);
      readFile.returns('{}');
      loadAndProcessConfigStub.returns(config);
      sandbox.stub((provider as any).scriptBundler, 'bundle').resolves({
        success: true,
        code: 'bundled script',
      });
      const loadScript = sandbox.stub((provider as any).scriptEvaluator, 'loadScript');
      loadScript.onFirstCall().returns({ declarations: 'uniform float before;', uniforms: [] });
      loadScript.onSecondCall().returns({ declarations: 'uniform float after;', uniforms: [] });

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));
      await provider.sendShaderFromEditor(editorFor(commonPath, 'float helper() { return 1.0; }'));
      onPreamblePreparation.resetHistory();
      await provider.sendShaderWithScriptContent(shaderPath, 'export function uniforms() {}');

      sinon.assert.calledOnce(onPreamblePreparation);
      assert.deepStrictEqual(onPreamblePreparation.firstCall.args[0].snapshot, {
        shaderPath,
        configPath: '/workspace/script-refresh.sha.json',
        passName: 'common',
        inputs,
        customUniformDeclarations: 'uniform float after;',
      });
    });

    test('ignores a background root refresh without replacing the active Buffer pass', async () => {
      const activeRoot = '/workspace/active.glsl';
      const activeBuffer = '/workspace/active-buffer.glsl';
      const backgroundRoot = '/workspace/background.glsl';
      const activeConfig = {
        version: '1.0',
        passes: {
          Image: {},
          BufferA: { path: './active-buffer.glsl' },
        },
      };
      const backgroundConfig = {
        version: '1.0',
        passes: { Image: { inputs: { background: { type: 'keyboard' } } } },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const readFile = sandbox.stub(fs, 'readFileSync');
      readFile.withArgs(activeRoot, 'utf-8').returns(mainImageCode);
      readFile.withArgs(backgroundRoot, 'utf-8').returns(mainImageCode);
      readFile.returns('{}');
      loadAndProcessConfigStub.callsFake((shaderPath: string) => (
        shaderPath === backgroundRoot ? backgroundConfig : activeConfig
      ));

      await provider.sendShaderFromEditor(editorFor(activeRoot, mainImageCode));
      await provider.sendShaderFromEditor(editorFor(activeBuffer, 'void renderBuffer() {}'));
      onPreamblePreparation.resetHistory();
      await provider.sendShaderFromPath(backgroundRoot);

      sinon.assert.notCalled(onPreamblePreparation);

      await provider.sendShaderFromPath(activeRoot);
      sinon.assert.calledOnce(onPreamblePreparation);
      assert.strictEqual(onPreamblePreparation.firstCall.args[0].snapshot.passName, 'BufferA');
      assert.strictEqual(onPreamblePreparation.firstCall.args[0].snapshot.shaderPath, activeRoot);
    });

    test('ignores a background Buffer path refresh without replacing the active pass', async () => {
      const shaderPath = '/workspace/multi-buffer.glsl';
      const activeBuffer = '/workspace/active-a.glsl';
      const backgroundBuffer = '/workspace/background-b.glsl';
      const config = {
        version: '1.0',
        passes: {
          Image: {},
          BufferA: { path: './active-a.glsl' },
          BufferB: { path: './background-b.glsl' },
        },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const readFile = sandbox.stub(fs, 'readFileSync');
      readFile.withArgs(shaderPath, 'utf-8').returns(mainImageCode);
      readFile.withArgs(backgroundBuffer, 'utf-8').returns('void renderBuffer() {}');
      readFile.returns('{}');
      loadAndProcessConfigStub.returns(config);

      await provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode));
      await provider.sendShaderFromEditor(editorFor(activeBuffer, 'void renderBuffer() {}'));
      onPreamblePreparation.resetHistory();
      await provider.sendShaderFromPath(backgroundBuffer);

      sinon.assert.notCalled(onPreamblePreparation);
      assert.strictEqual(sendSpy.lastCall.args[0].path, backgroundBuffer);

      await provider.sendShaderFromPath(shaderPath);
      sinon.assert.calledOnce(onPreamblePreparation);
      assert.strictEqual(onPreamblePreparation.firstCall.args[0].snapshot.passName, 'BufferA');
    });

    test('caches successful background declarations without publishing the background root', async () => {
      const backgroundRoot = '/workspace/background-cache.glsl';
      const backgroundBuffer = '/workspace/background-cache-buffer.glsl';
      const activeRoot = '/workspace/foreground.glsl';
      const activeBuffer = '/workspace/foreground-buffer.glsl';
      const backgroundConfig = {
        version: '1.0',
        script: './uniforms.ts',
        passes: {
          Image: {},
          BufferA: { path: './background-cache-buffer.glsl' },
        },
      };
      const activeConfig = {
        version: '1.0',
        passes: {
          Image: {},
          BufferA: { path: './foreground-buffer.glsl' },
        },
      };
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const readFile = sandbox.stub(fs, 'readFileSync');
      readFile.withArgs(backgroundRoot, 'utf-8').returns(mainImageCode);
      readFile.withArgs(activeRoot, 'utf-8').returns(mainImageCode);
      readFile.returns('{}');
      loadAndProcessConfigStub.callsFake((shaderPath: string) => (
        shaderPath === backgroundRoot ? backgroundConfig : activeConfig
      ));
      sandbox.stub((provider as any).scriptBundler, 'bundle').resolves({
        success: true,
        code: 'bundled script',
      });
      const loadScript = sandbox.stub((provider as any).scriptEvaluator, 'loadScript');
      loadScript.onFirstCall().returns({ declarations: 'uniform float before;', uniforms: [] });
      loadScript.onSecondCall().returns({ declarations: 'uniform float after;', uniforms: [] });

      await provider.sendShaderFromEditor(editorFor(backgroundRoot, mainImageCode));
      await provider.sendShaderFromEditor(editorFor(activeRoot, mainImageCode));
      await provider.sendShaderFromEditor(editorFor(activeBuffer, 'void renderBuffer() {}'));
      onPreamblePreparation.resetHistory();

      await provider.sendShaderFromPath(backgroundRoot);
      sinon.assert.notCalled(onPreamblePreparation);

      await provider.sendShaderFromEditor(editorFor(backgroundBuffer, 'void renderBuffer() {}'));
      sinon.assert.calledOnce(onPreamblePreparation);
      assert.strictEqual(
        onPreamblePreparation.firstCall.args[0].snapshot.customUniformDeclarations,
        'uniform float after;',
      );
    });

    test('preserves legacy message delivery when no preparation callback is provided', async () => {
      const shaderPath = '/workspace/legacy-caller.glsl';
      const legacyProvider = new ShaderProvider(
        mockMessenger,
        undefined,
        new ConfigChangeClassifier(),
      );
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').throws(new Error('unexpected preparation work'));
      loadAndProcessConfigStub.returns(null);

      await assert.doesNotReject(() => (
        legacyProvider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode))
      ));

      sinon.assert.calledOnce(sendSpy);
      assert.strictEqual(sendSpy.firstCall.args[0].type, 'shaderSource');
    });

    for (const callbackFailure of ['throw', 'reject'] as const) {
      test(`does not block shader delivery when the preparation callback ${callbackFailure}s`, async () => {
        const shaderPath = `/workspace/callback-${callbackFailure}.glsl`;
        const fs = require('fs');
        sandbox.stub(fs, 'existsSync').returns(false);
        loadAndProcessConfigStub.returns(null);
        if (callbackFailure === 'throw') {
          onPreamblePreparation.throws(new Error('callback failed'));
        } else {
          onPreamblePreparation.rejects(new Error('callback failed'));
        }

        await assert.doesNotReject(() => (
          provider.sendShaderFromEditor(editorFor(shaderPath, mainImageCode))
        ));
        await new Promise(resolve => setImmediate(resolve));

        sinon.assert.calledOnce(sendSpy);
        assert.strictEqual(sendSpy.firstCall.args[0].type, 'shaderSource');
        sinon.assert.calledOnce(mockOutputChannel.warn);
        assert.match(
          mockOutputChannel.warn.firstCall.args[0],
          /Failed to publish Shader Validator preamble context: Error: callback failed/,
        );
      });
    }
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
