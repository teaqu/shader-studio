import * as assert from 'assert';
import * as fs from 'fs';
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

    provider = new ShaderProvider(
      mockMessenger,
      undefined,
      new ConfigChangeClassifier(),
    );
  });

  teardown(() => {
    sandbox.restore();
  });


  suite('sendShaderFromEditor', () => {

    test('sends a configured Image vertex file as its own source', async () => {
      const shaderPath = '/path/to/main.glsl';
      const vertexPath = '/path/to/main.vert.glsl';
      const vertexSource = 'void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv) {}';
      const config = { version: '1.0', passes: { Image: { vertex: 'main.vert.glsl' } } };
      loadAndProcessConfigStub.returns(config as any);
      (provider as any).activeShaders.add(shaderPath);
      provider.claimActiveAnalysisContext(vertexPath);

      await provider.sendShaderFromEditor({
        document: {
          getText: () => vertexSource,
          uri: { fsPath: vertexPath }, languageId: 'glsl',
          lineAt: () => ({ text: vertexSource }),
        },
        selection: { active: { line: 0, character: 0 } },
      } as any);

      sinon.assert.calledOnce(sendSpy);
      assert.strictEqual(sendSpy.firstCall.args[0].path, vertexPath);
    });

    test('sends an unlocked configured compute pass as a standalone source', async () => {
      const shaderPath = '/path/to/main.slang';
      const computePath = '/path/to/sim.slang';
      const computeSource = 'void computeMain(uint3 tid) {}';
      loadAndProcessConfigStub.returns({
        version: '1.0',
        passes: {
          Image: {},
          ComputeSim: { path: 'sim.slang', inputs: {} },
        },
      } as any);
      sandbox.stub(PathResolver, 'resolvePath').callsFake((_shaderPath: string, targetPath: string) => {
        return `/path/to/${targetPath}`;
      });
      (provider as any).activeShaders.add(shaderPath);

      await provider.sendShaderFromEditor({
        document: {
          getText: () => computeSource,
          uri: { fsPath: computePath },
          fileName: computePath,
          languageId: 'slang',
          lineAt: () => ({ text: computeSource }),
        },
        selection: { active: { line: 0, character: 0 } },
      } as any);

      sinon.assert.calledOnce(sendSpy);
      assert.strictEqual(sendSpy.firstCall.args[0].path, computePath);
      assert.strictEqual(sendSpy.firstCall.args[0].code, computeSource);
      assert.strictEqual(sendSpy.firstCall.args[0].config, null);
    });

    test('sends a native Slang compute entrypoint as a standalone source', async () => {
      const computePath = '/path/to/native-compute.slang';
      const computeSource = '[shader("compute")] [numthreads(8, 8, 1)] void update(uint3 tid : SV_DispatchThreadID) {}';

      await provider.sendShaderFromEditor({
        document: {
          getText: () => computeSource,
          uri: { fsPath: computePath },
          fileName: computePath,
          languageId: 'slang',
          lineAt: () => ({ text: computeSource }),
        },
        selection: { active: { line: 0, character: 0 } },
      } as any);

      sinon.assert.calledOnce(sendSpy);
      assert.strictEqual(sendSpy.firstCall.args[0].path, computePath);
      assert.strictEqual(sendSpy.firstCall.args[0].code, computeSource);
      assert.strictEqual(sendSpy.firstCall.args[0].config, null);
    });

    test('does not re-route a locked compute pass to its shader root', async () => {
      const shaderPath = '/path/to/main.slang';
      const computePath = '/path/to/sim.slang';
      const computeSource = 'void computeMain(uint3 tid) {}';
      const lockedProvider = new ShaderProvider(
        mockMessenger,
        undefined,
        new ConfigChangeClassifier(),
        () => shaderPath,
      );
      (lockedProvider as any).activeShaders.add(shaderPath);

      await lockedProvider.sendShaderFromEditor({
        document: {
          getText: () => computeSource,
          uri: { fsPath: computePath },
          fileName: computePath,
          languageId: 'slang',
          lineAt: () => ({ text: computeSource }),
        },
        selection: { active: { line: 0, character: 0 } },
      } as any);

      sinon.assert.calledOnce(sendSpy);
      assert.strictEqual(sendSpy.firstCall.args[0].path, computePath);
      assert.strictEqual(sendSpy.firstCall.args[0].code, computeSource);
      assert.strictEqual(sendSpy.firstCall.args[0].config, null);
    });

    test('keeps a configured Slang vertex cursor on its own source', async () => {
      const vertexPath = '/path/to/main.image.vert.slang';
      const vertexSource = 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) {}';
      const config = { version: '1.0', passes: { Image: { vertex: 'main.image.vert.slang' } } };
      const debugProvider = new ShaderProvider(mockMessenger, () => true, new ConfigChangeClassifier());
      loadAndProcessConfigStub.callsFake((_path: string, buffers: Record<string, string>) => {
        buffers['__shader_studio_vertex__:Image'] = vertexSource;
        return config as any;
      });
      await debugProvider.sendShaderFromEditor({
        document: {
          getText: () => vertexSource,
          uri: { fsPath: vertexPath },
          languageId: 'slang',
          fileName: vertexPath,
          lineAt: () => ({ text: vertexSource }),
        },
        selection: { active: { line: 0, character: 0 } },
      } as any);

      const message = sendSpy.lastCall.args[0];
      assert.strictEqual(message.type, 'shaderSource');
      assert.strictEqual(message.path, vertexPath);
      assert.strictEqual(message.cursorPosition?.filePath, vertexPath);
    });

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
      assert.strictEqual((provider as any).activeShaders.has(shaderPath), true);
    });

    test('should attach imported Slang modules to the shader message', async () => {
      const shaderPath = '/path/to/image.slang';
      const dependencyPath = '/path/to/palette.slang';
      const dependencySource = 'module palette;\npublic float4 color() { return 1; }';
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').callsFake((filePath: unknown) => filePath === dependencyPath);
      sandbox.stub(fs, 'readFileSync').callsFake((filePath: unknown) => {
        if (filePath === dependencyPath) {
          return dependencySource;
        }
        throw new Error(`unexpected read: ${filePath}`);
      });

      const mockEditor = {
        document: {
          getText: sandbox.stub().returns('import palette;\nfloat4 mainImage(float2 p) { return color(); }'),
          uri: { fsPath: shaderPath },
          fileName: shaderPath,
          languageId: 'slang',
          lineAt: sandbox.stub().returns({ text: '' }),
        },
        selection: { active: { line: 0, character: 0 } },
      };
      loadAndProcessConfigStub.returns({ version: '1.0', passes: { Image: {} } });

      await provider.sendShaderFromEditor(mockEditor as any);

      const message = sendSpy.firstCall.args[0];
      assert.deepStrictEqual(message.slangModules, [{
        moduleName: 'palette',
        path: dependencyPath,
        source: dependencySource,
        ownerPass: 'Image',
      }]);
      assert.deepStrictEqual(message.slangDependencyDiagnostics, []);
    });

    test('should attach imports when debugging an unlocked Slang helper without mainImage', async () => {
      const shaderPath = '/path/to/debugpalette.slang';
      const dependencyPath = '/path/to/debugmath.slang';
      const dependencySource = 'module debugmath;\npublic float debugWave(float phase) { return sin(phase); }';
      const source = [
        'module debugpalette;',
        'import debugmath;',
        'public float3 debugPalette(float phase)',
        '{',
        '    float blend = debugWave(phase);',
        '    return float3(blend);',
        '}',
      ].join('\n');
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').callsFake((filePath: unknown) => filePath === dependencyPath);
      sandbox.stub(fs, 'readFileSync').callsFake((filePath: unknown) => {
        if (filePath === dependencyPath) {
          return dependencySource;
        }
        throw new Error(`unexpected read: ${filePath}`);
      });
      const providerWithDebug = new ShaderProvider(mockMessenger, () => true);

      await providerWithDebug.sendShaderFromEditor({
        document: {
          getText: sandbox.stub().returns(source),
          uri: { fsPath: shaderPath },
          fileName: shaderPath,
          languageId: 'slang',
          lineAt: sandbox.stub().returns({ text: '    float blend = debugWave(phase);' }),
        },
        selection: { active: { line: 4, character: 10 } },
      } as any);

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.deepStrictEqual(message.slangModules, [{
        moduleName: 'debugmath',
        path: dependencyPath,
        source: dependencySource,
        ownerPass: 'Image',
      }]);
      assert.deepStrictEqual(message.slangDependencyDiagnostics, []);
      assert.strictEqual(message.cursorPosition?.filePath, shaderPath);
    });

    test('should switch to an imported Slang module without mainImage when the owner is not locked', async () => {
      const ownerPath = '/path/to/image.slang';
      const dependencyPath = '/path/to/palette.slang';
      const ownerSource = 'import palette;\nfloat4 mainImage(float2 p) { return color(); }';
      const dependencySource = 'module palette;\npublic float4 color() { return 0.5; }';
      (provider as any).activeShaders.add(ownerPath);
      sandbox.stub(provider as any, 'readShaderSource').callsFake((filePath: unknown) => {
        if (filePath === ownerPath) {
          return ownerSource;
        }
        if (filePath === dependencyPath) {
          return dependencySource;
        }
        return null;
      });
      loadAndProcessConfigStub.returns({ version: '1.0', passes: { Image: {} } });

      await provider.sendShaderFromEditor({
        document: {
          getText: sandbox.stub().returns(dependencySource),
          uri: { fsPath: dependencyPath },
          fileName: dependencyPath,
          languageId: 'slang',
          lineAt: sandbox.stub().returns({ text: 'public float4 color() { return 0.5; }' }),
        },
        selection: { active: { line: 1, character: 8 } },
      } as any);

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.deepStrictEqual(message, {
        type: 'shaderSource',
        code: dependencySource,
        config: null,
        path: dependencyPath,
        buffers: {},
        language: 'slang',
        reload: true,
        cursorPosition: undefined,
        slangModules: [],
        slangDependencyDiagnostics: [],
      });
    });

    test('should resend the locked owner when navigating to an imported Slang module', async () => {
      const ownerPath = '/path/to/image.slang';
      const dependencyPath = '/path/to/palette.slang';
      const ownerSource = 'import palette;\nfloat4 mainImage(float2 p) { return color(); }';
      const dependencySource = 'module palette;\npublic float4 color() { return 0.5; }';
      const lockedProvider = new ShaderProvider(
        mockMessenger,
        () => true,
        new ConfigChangeClassifier(),
        () => ownerPath,
      );
      (lockedProvider as any).activeShaders.add(ownerPath);
      sandbox.stub(lockedProvider as any, 'readShaderSource').callsFake((filePath: unknown) => {
        if (filePath === ownerPath) {
          return ownerSource;
        }
        if (filePath === dependencyPath) {
          return dependencySource;
        }
        return null;
      });
      loadAndProcessConfigStub.returns({ version: '1.0', passes: { Image: {} } });

      await lockedProvider.sendShaderFromEditor({
        document: {
          getText: sandbox.stub().returns(dependencySource),
          uri: { fsPath: dependencyPath },
          fileName: dependencyPath,
          languageId: 'slang',
          lineAt: sandbox.stub().returns({ text: 'public float4 color() { return 0.5; }' }),
        },
        selection: { active: { line: 1, character: 8 } },
      } as any);

      sinon.assert.calledOnce(sendSpy);
      const message = sendSpy.firstCall.args[0];
      assert.strictEqual(message.type, 'shaderSource');
      assert.strictEqual(message.path, ownerPath);
      assert.strictEqual(message.cursorPosition?.filePath, dependencyPath);
      assert.deepStrictEqual(message.slangModules, [{
        moduleName: 'palette',
        path: dependencyPath,
        source: dependencySource,
        ownerPass: 'Image',
      }]);
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

    for (const fixture of [
      {
        label: 'GLSL',
        shaderPath: '/path/to/shader.glsl',
        languageId: 'glsl',
        code: 'void someFunction() {}',
        language: 'glsl',
      },
      {
        label: 'Slang',
        shaderPath: '/path/to/shader.slang',
        languageId: 'slang',
        code: 'float someFunction() { return 1.0; }',
        language: 'slang',
      },
    ] as const) {
      test(`should send unlocked ${fixture.label} files without mainImage through the normal shader switch path`, async () => {
        const mockEditor = {
          document: {
            getText: sandbox.stub().returns(fixture.code),
            uri: { fsPath: fixture.shaderPath },
            fileName: fixture.shaderPath,
            languageId: fixture.languageId,
          },
          selection: { active: { line: 0, character: 0 } },
        };

        await provider.sendShaderFromEditor(mockEditor as any);

        sinon.assert.calledOnce(sendSpy);
        sinon.assert.calledWith(sendSpy, sinon.match({
          type: 'shaderSource',
          code: fixture.code,
          config: null,
          path: fixture.shaderPath,
          buffers: {},
          language: fixture.language,
          reload: true,
        }));
      });
    }

    test('should switch to standalone common editor files without mainImage', async () => {
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
        type: 'shaderSource',
        code: 'float helper() { return 1.0; }',
        config: null,
        path: shaderPath,
        buffers: {},
        language: 'glsl',
        reload: true,
        cursorPosition: undefined,
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

    test('should map configured render and compute pass names to resolved absolute paths', () => {
      const config = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
          BufferB: { path: 'bufferB.glsl', inputs: {} },
          ComputeSim: { path: 'sim.slang', inputs: {} },
          BlurPass: { path: 'blur.glsl', inputs: {} },
        }
      };

      const result = (provider as any).buildBufferPathMap(config, '/path/to/shader.glsl');
      assert.strictEqual(result.Image, '/path/to/shader.glsl');
      assert.strictEqual(result.BufferA, '/resolved/bufferA.glsl');
      assert.strictEqual(result.BufferB, '/resolved/bufferB.glsl');
      assert.strictEqual(result.ComputeSim, '/resolved/sim.slang');
      assert.strictEqual(result.BlurPass, '/resolved/blur.glsl');
    });

    test('should map vertex sources for Image and buffer passes', () => {
      const result = (provider as any).buildBufferPathMap({
        version: '1.0',
        passes: {
          Image: { vertex: 'image.vert.glsl' },
          BufferA: { path: 'buffer.glsl', vertex: 'buffer.vert.glsl' },
        },
      }, '/path/to/shader.glsl');

      assert.strictEqual(result['__shader_studio_vertex__:Image'], '/resolved/image.vert.glsl');
      assert.strictEqual(result['__shader_studio_vertex__:BufferA'], '/resolved/buffer.vert.glsl');
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

    test('should switch to files without mainImage', async () => {
      const shaderPath = '/path/to/shader.glsl';
      const fs = require('fs');

      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync').returns('void someFunction() {}');

      await provider.sendShaderFromPath(shaderPath);

      sinon.assert.calledOnce(sendSpy);
      sinon.assert.calledWith(sendSpy, {
        type: 'shaderSource',
        code: 'void someFunction() {}',
        config: null,
        path: shaderPath,
        buffers: {},
        language: 'glsl',
        reload: true,
        cursorPosition: undefined,
      });
    });

    test('should switch to standalone common paths without mainImage', async () => {
      const shaderPath = '/path/to/shader.common.glsl';
      const fs = require('fs');

      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync')
        .withArgs(shaderPath, 'utf-8').returns('float helper() { return 1.0; }');

      await provider.sendShaderFromPath(shaderPath);

      sinon.assert.calledOnce(sendSpy);
      sinon.assert.calledWith(sendSpy, {
        type: 'shaderSource',
        code: 'float helper() { return 1.0; }',
        config: null,
        path: shaderPath,
        buffers: {},
        language: 'glsl',
        reload: true,
        cursorPosition: undefined,
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

  suite('sendShaderWithScriptContent', () => {
    test('preserves Slang dependency modules when script content changes', async () => {
      const shaderPath = '/path/to/image.slang';
      const dependencyPath = '/path/to/palette.slang';
      const rootSource = 'import palette;\nfloat4 mainImage(float2 p) { return color(); }';
      const dependencySource = 'module palette;\npublic float4 color() { return 1; }';
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').callsFake((filePath: unknown) =>
        filePath === shaderPath || filePath === dependencyPath);
      sandbox.stub(fs, 'readFileSync').callsFake((filePath: unknown) => {
        if (filePath === shaderPath) {
          return rootSource;
        }
        if (filePath === dependencyPath) {
          return dependencySource;
        }
        throw new Error(`unexpected read: ${filePath}`);
      });
      loadAndProcessConfigStub.returns({ version: '1.0', passes: { Image: {} } });

      await provider.sendShaderWithScriptContent(shaderPath, 'export default {}');

      const message = sendSpy.firstCall.args[0];
      assert.strictEqual(message.language, 'slang');
      assert.deepStrictEqual(message.slangModules, [{
        moduleName: 'palette',
        path: dependencyPath,
        source: dependencySource,
        ownerPass: 'Image',
      }]);
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

    test('should switch to standalone common documents without mainImage', async () => {
      const shaderPath = '/path/to/shader.common.glsl';
      const document = {
        getText: sandbox.stub().returns('float helper() { return 1.0; }'),
        uri: vscode.Uri.file(shaderPath),
        languageId: 'glsl',
      } as any;

      await provider.sendShaderFromDocument(document);

      sinon.assert.calledOnce(sendSpy);
      sinon.assert.calledWith(sendSpy, {
        type: 'shaderSource',
        code: 'float helper() { return 1.0; }',
        config: null,
        path: shaderPath,
        buffers: {},
        language: 'glsl',
        reload: true,
        cursorPosition: undefined,
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
