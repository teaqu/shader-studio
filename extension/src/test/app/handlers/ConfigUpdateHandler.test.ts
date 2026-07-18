import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ConfigUpdateHandler, computeMinimalReplace } from '../../../app/handlers/ConfigUpdateHandler';
import { Logger } from '../../../app/services/Logger';
import { ConfigChangeClassifier } from '../../../app/services/ConfigChangeClassifier';
import { getConfigPathForShaderPath } from '../../../app/ShaderConfigPaths';

suite('ConfigUpdateHandler Test Suite', () => {
  let handler: ConfigUpdateHandler;
  let sandbox: sinon.SinonSandbox;
  let mockGlslFileTracker: any;
  let mockShaderProvider: any;
  let mockMessenger: any;
  let logger: Logger;

  setup(() => {
    sandbox = sinon.createSandbox();

    const mockOutputChannel = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      dispose: sandbox.stub(),
    } as any;
    Logger.initialize(mockOutputChannel);
    logger = Logger.getInstance();

    mockGlslFileTracker = {
      getActiveOrLastViewedGLSLEditor: sandbox.stub().returns(null),
    } as any;

    mockShaderProvider = {
      sendShaderFromPath: sandbox.stub().resolves(),
    } as any;

    mockMessenger = {
      send: sandbox.stub(),
    } as any;

    handler = new ConfigUpdateHandler(
      mockGlslFileTracker,
      mockShaderProvider,
      mockMessenger,
      logger,
    );
  });

  teardown(() => {
    sandbox.restore();
    (Logger as any).instance = undefined;
  });

  test('can be instantiated', () => {
    assert.ok(handler instanceof ConfigUpdateHandler);
  });

  suite('handleConfigUpdate', () => {
    test('writes config file with the provided text', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{"version":1}',
        shaderPath: '/test/shader.glsl',
      });

      assert.ok(writeStub.calledOnce);
      assert.strictEqual(writeStub.firstCall.args[0], '/test/shader.sha.json');
      assert.strictEqual(writeStub.firstCall.args[1], '{"version":1}');
      assert.strictEqual(writeStub.firstCall.args[2], 'utf-8');
    });

    test('replaces .frag extension when deriving config path', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{}',
        shaderPath: '/test/shader.frag',
      });

      assert.ok(writeStub.calledOnce);
      assert.strictEqual(writeStub.firstCall.args[0], '/test/shader.sha.json');
    });

    test('writes .slang shader updates to the companion .sha.json config file', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{}',
        shaderPath: '/test/shader.slang',
      });

      assert.ok(writeStub.calledOnce);
      assert.strictEqual(writeStub.firstCall.args[0], '/test/shader.sha.json');
    });

    test('triggers shader refresh after timeout when skipRefresh is not set', async () => {
      const clock = sandbox.useFakeTimers();
      const fs = require('fs');
      sandbox.stub(fs, 'writeFileSync');

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{}',
        shaderPath: '/test/shader.glsl',
      });

      assert.ok(mockShaderProvider.sendShaderFromPath.notCalled);
      clock.tick(200);
      assert.ok(mockShaderProvider.sendShaderFromPath.calledOnce);
      assert.strictEqual(mockShaderProvider.sendShaderFromPath.firstCall.args[0], '/test/shader.glsl');
      assert.deepStrictEqual(mockShaderProvider.sendShaderFromPath.firstCall.args[1], { reload: true });

      clock.restore();
    });

    test('skips shader refresh when skipRefresh is true', async () => {
      const clock = sandbox.useFakeTimers();
      const fs = require('fs');
      sandbox.stub(fs, 'writeFileSync');

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{}',
        shaderPath: '/test/shader.glsl',
        skipRefresh: true,
      });

      clock.tick(300);
      assert.ok(mockShaderProvider.sendShaderFromPath.notCalled);

      clock.restore();
    });

    suite('classified verdict (disk-write fallback)', () => {
      const shaderPath = '/test/shader.glsl';
      const configPath = getConfigPathForShaderPath(shaderPath);
      const baseConfig = {
        passes: {
          Image: {
            inputs: {
              iChannel0: { path: 'video.mp4', muted: false },
            },
          },
        },
      };

      function makeHandlerWithClassifier(): { handler: ConfigUpdateHandler; classifier: ConfigChangeClassifier } {
        const classifier = new ConfigChangeClassifier();
        const handlerWithClassifier = new ConfigUpdateHandler(
          mockGlslFileTracker,
          mockShaderProvider,
          mockMessenger,
          logger,
          classifier,
        );
        return { handler: handlerWithClassifier, classifier };
      }

      test('muted-only change sends no shader update', async () => {
        const clock = sandbox.useFakeTimers();
        const fs = require('fs');
        sandbox.stub(fs, 'writeFileSync');
        const { handler: handlerWithClassifier, classifier } = makeHandlerWithClassifier();
        classifier.recordSentConfig(configPath, JSON.stringify(baseConfig));

        const mutedConfig = {
          passes: {
            Image: {
              inputs: {
                iChannel0: { path: 'video.mp4', muted: true },
              },
            },
          },
        };
        const text = JSON.stringify(mutedConfig);

        await handlerWithClassifier.handleConfigUpdate({
          config: mutedConfig as any,
          text,
          shaderPath,
        });

        clock.tick(200);
        assert.ok(mockShaderProvider.sendShaderFromPath.notCalled);

        clock.restore();
      });

      test('formatting-only change sends nothing', async () => {
        const clock = sandbox.useFakeTimers();
        const fs = require('fs');
        sandbox.stub(fs, 'writeFileSync');
        const { handler: handlerWithClassifier, classifier } = makeHandlerWithClassifier();
        classifier.recordSentConfig(configPath, JSON.stringify(baseConfig));

        const text = JSON.stringify(baseConfig, null, 2);

        await handlerWithClassifier.handleConfigUpdate({
          config: baseConfig as any,
          text,
          shaderPath,
        });

        clock.tick(200);
        assert.ok(mockShaderProvider.sendShaderFromPath.notCalled);

        clock.restore();
      });

      test('structural change sends reload', async () => {
        const clock = sandbox.useFakeTimers();
        const fs = require('fs');
        sandbox.stub(fs, 'writeFileSync');
        const { handler: handlerWithClassifier, classifier } = makeHandlerWithClassifier();
        classifier.recordSentConfig(configPath, JSON.stringify(baseConfig));

        const structuralConfig = {
          passes: {
            Image: {
              inputs: {
                iChannel0: { path: 'other-video.mp4', muted: false },
              },
            },
          },
        };
        const text = JSON.stringify(structuralConfig);

        await handlerWithClassifier.handleConfigUpdate({
          config: structuralConfig as any,
          text,
          shaderPath,
        });

        clock.tick(200);
        assert.ok(mockShaderProvider.sendShaderFromPath.calledOnce);
        assert.strictEqual(mockShaderProvider.sendShaderFromPath.firstCall.args[0], shaderPath);
        assert.deepStrictEqual(mockShaderProvider.sendShaderFromPath.firstCall.args[1], { reload: true });

        clock.restore();
      });

      test("no prior snapshot sends reload (mirrors watcher's first-change-no-snapshot case)", async () => {
        const clock = sandbox.useFakeTimers();
        const fs = require('fs');
        sandbox.stub(fs, 'writeFileSync');
        const { handler: handlerWithClassifier } = makeHandlerWithClassifier();
        // No prior recordSentConfig call — classifier has never seen this config path.

        const text = JSON.stringify(baseConfig);

        await handlerWithClassifier.handleConfigUpdate({
          config: baseConfig as any,
          text,
          shaderPath,
        });

        clock.tick(200);
        assert.ok(mockShaderProvider.sendShaderFromPath.calledOnce);
        assert.strictEqual(mockShaderProvider.sendShaderFromPath.firstCall.args[0], shaderPath);
        assert.deepStrictEqual(mockShaderProvider.sendShaderFromPath.firstCall.args[1], { reload: true });

        clock.restore();
      });

      test("classifier throw falls back to reload (mirrors watcher's throw fallback)", async () => {
        const clock = sandbox.useFakeTimers();
        const fs = require('fs');
        sandbox.stub(fs, 'writeFileSync');
        const { handler: handlerWithClassifier, classifier } = makeHandlerWithClassifier();
        sandbox.stub(classifier, 'classifyChange').throws(new Error('boom'));

        await handlerWithClassifier.handleConfigUpdate({
          config: baseConfig as any,
          text: JSON.stringify(baseConfig),
          shaderPath,
        });

        clock.tick(200);
        assert.ok(mockShaderProvider.sendShaderFromPath.calledOnce);
        assert.deepStrictEqual(mockShaderProvider.sendShaderFromPath.firstCall.args[1], { reload: true });

        clock.restore();
      });
    });

    test('falls back to active GLSL editor when shaderPath is not provided', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');
      mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns({
        document: { uri: { fsPath: '/active/editor.glsl' } },
      });

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{}',
      });

      assert.ok(writeStub.calledOnce);
      assert.strictEqual(writeStub.firstCall.args[0], '/active/editor.sha.json');
    });

    test('returns early when shaderPath is absent and no active editor', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');
      mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns(null);

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{}',
      });

      assert.ok(writeStub.notCalled);
    });

    test('sends error message to messenger when writeFileSync throws', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'writeFileSync').throws(new Error('Disk full'));

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{}',
        shaderPath: '/test/shader.glsl',
      });

      assert.ok((mockMessenger.send as sinon.SinonStub).calledOnce);
      const msg = (mockMessenger.send as sinon.SinonStub).firstCall.args[0];
      assert.strictEqual(msg.type, 'error');
      assert.ok(Array.isArray(msg.payload));
      assert.ok((msg.payload[0] as string).includes('Failed to update shader config'));
    });

    test('does not throw when messenger is null and write fails', async () => {
      const handlerNoMessenger = new ConfigUpdateHandler(
        mockGlslFileTracker,
        mockShaderProvider,
        null,
        logger,
      );
      const fs = require('fs');
      sandbox.stub(fs, 'writeFileSync').throws(new Error('IO error'));

      await assert.doesNotReject(
        handlerNoMessenger.handleConfigUpdate({
          config: {} as any,
          text: '{}',
          shaderPath: '/test/shader.glsl',
        }),
      );
    });
  });

  suite('handleConfigUpdate - WorkspaceEdit when document is open', () => {
    test('applies WorkspaceEdit instead of writeFileSync when document is open', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      const mockDocument = {
        uri: { fsPath: '/test/shader.sha.json' } as any,
        getText: sandbox.stub().returns('{"old":true}'),
        positionAt: (offset: number) => new vscode.Position(0, offset),
      };
      sandbox.stub(vscode.workspace, 'textDocuments').value([mockDocument]);
      const applyEditStub = sandbox.stub(vscode.workspace, 'applyEdit').resolves(true);

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{"version":1}',
        shaderPath: '/test/shader.glsl',
        skipRefresh: true,
      });

      sinon.assert.calledOnce(applyEditStub);
      sinon.assert.notCalled(writeStub);
    });

    test('applies WorkspaceEdit to the companion config document for .slang shaders', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      const mockDocument = {
        uri: { fsPath: '/test/shader.sha.json' } as any,
        getText: sandbox.stub().returns('{"old":true}'),
        positionAt: (offset: number) => new vscode.Position(0, offset),
      };
      sandbox.stub(vscode.workspace, 'textDocuments').value([mockDocument]);
      const applyEditStub = sandbox.stub(vscode.workspace, 'applyEdit').resolves(true);

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{"version":1}',
        shaderPath: '/test/shader.slang',
        skipRefresh: true,
      });

      sinon.assert.calledOnce(applyEditStub);
      sinon.assert.notCalled(writeStub);
    });

    test('skips edit when buffer content already matches incoming text', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      const text = '{"version":1}';
      const mockDocument = {
        uri: { fsPath: '/test/shader.sha.json' } as any,
        getText: sandbox.stub().returns(text),
        positionAt: (offset: number) => new vscode.Position(0, offset),
      };
      sandbox.stub(vscode.workspace, 'textDocuments').value([mockDocument]);
      const applyEditStub = sandbox.stub(vscode.workspace, 'applyEdit').resolves(true);

      await handler.handleConfigUpdate({
        config: {} as any,
        text,
        shaderPath: '/test/shader.glsl',
        skipRefresh: true,
      });

      sinon.assert.notCalled(applyEditStub);
      sinon.assert.notCalled(writeStub);
    });

    test('falls back to writeFileSync when applyEdit returns false', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      const mockDocument = {
        uri: { fsPath: '/test/shader.sha.json' } as any,
        getText: sandbox.stub().returns('{"old":true}'),
        positionAt: (offset: number) => new vscode.Position(0, offset),
      };
      sandbox.stub(vscode.workspace, 'textDocuments').value([mockDocument]);
      sandbox.stub(vscode.workspace, 'applyEdit').resolves(false);

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{"version":1}',
        shaderPath: '/test/shader.glsl',
        skipRefresh: true,
      });

      sinon.assert.calledOnce(writeStub);
    });

    test('does NOT schedule a manual refresh when applyEdit succeeds', async () => {
      const clock = sandbox.useFakeTimers();
      const fs = require('fs');
      sandbox.stub(fs, 'writeFileSync');

      const mockDocument = {
        uri: { fsPath: '/test/shader.sha.json' } as any,
        getText: sandbox.stub().returns('{"old":true}'),
        positionAt: (offset: number) => new vscode.Position(0, offset),
      };
      sandbox.stub(vscode.workspace, 'textDocuments').value([mockDocument]);
      sandbox.stub(vscode.workspace, 'applyEdit').resolves(true);

      await handler.handleConfigUpdate({
        config: {} as any,
        text: '{"version":1}',
        shaderPath: '/test/shader.glsl',
      });

      clock.tick(300);
      sinon.assert.notCalled(mockShaderProvider.sendShaderFromPath);

      clock.restore();
    });
  });

  suite('computeMinimalReplace', () => {
    test('replaces only the diverging slice', () => {
      const result = computeMinimalReplace('{"old":true}', '{"new":true}');
      assert.strictEqual(result.startOffset, 2);
      assert.strictEqual(result.endOffsetOld, 5);
      assert.strictEqual(result.replacement, 'new');
    });

    test('handles inserts at start', () => {
      const result = computeMinimalReplace('bar', 'foobar');
      assert.strictEqual(result.startOffset, 0);
      assert.strictEqual(result.endOffsetOld, 0);
      assert.strictEqual(result.replacement, 'foo');
    });

    test('handles inserts at end', () => {
      const result = computeMinimalReplace('foo', 'foobar');
      assert.strictEqual(result.startOffset, 3);
      assert.strictEqual(result.endOffsetOld, 3);
      assert.strictEqual(result.replacement, 'bar');
    });

    test('handles deletes from middle', () => {
      const result = computeMinimalReplace('fooXXXbar', 'foobar');
      assert.strictEqual(result.startOffset, 3);
      assert.strictEqual(result.endOffsetOld, 6);
      assert.strictEqual(result.replacement, '');
    });

    test('disjoint prefix/suffix shrink correctly when shorter side runs out', () => {
      const result = computeMinimalReplace('aaa', 'aaaa');
      assert.strictEqual(result.startOffset, 3);
      assert.strictEqual(result.endOffsetOld, 3);
      assert.strictEqual(result.replacement, 'a');
    });
  });
});
