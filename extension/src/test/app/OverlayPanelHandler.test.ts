import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { OverlayPanelHandler } from '../../app/OverlayPanelHandler';
import { Logger } from '../../app/services/Logger';

suite('OverlayPanelHandler Test Suite', () => {
  let handler: OverlayPanelHandler;
  let sandbox: sinon.SinonSandbox;

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

    handler = new OverlayPanelHandler();
  });

  teardown(() => {
    sandbox.restore();
    // Reset Logger singleton
    (Logger as any).instance = undefined;
  });

  suite('handleUpdateShaderSource', () => {
    test('should apply WorkspaceEdit when document is open', async () => {
      // Given
      const mockDoc = {
        uri: vscode.Uri.file('/path/to/shader.glsl'),
        getText: sandbox.stub().returns('old shader code'),
        positionAt: sandbox.stub().callsFake((offset: number) => new vscode.Position(0, offset)),
        save: sandbox.stub().resolves(true),
      };
      sandbox.stub(vscode.workspace, 'textDocuments').value([mockDoc]);
      const applyEditStub = sandbox.stub(vscode.workspace, 'applyEdit').resolves(true);

      // When
      await handler.handleUpdateShaderSource({ code: 'new shader code', path: '/path/to/shader.glsl' });

      // Then
      assert.ok(applyEditStub.calledOnce, 'applyEdit should be called once');
      assert.ok(mockDoc.save.notCalled, 'open document should not be force-saved after edit applied');
    });

    test('should avoid applying an edit when the open document already matches', async () => {
      const mockDoc = {
        uri: vscode.Uri.file('/path/to/shader.glsl'),
        getText: sandbox.stub().returns('same code'),
        positionAt: sandbox.stub().callsFake((offset: number) => new vscode.Position(0, offset)),
      };
      sandbox.stub(vscode.workspace, 'textDocuments').value([mockDoc]);
      const applyEditStub = sandbox.stub(vscode.workspace, 'applyEdit').resolves(true);

      await handler.handleUpdateShaderSource({ code: 'same code', path: '/path/to/shader.glsl' });

      assert.ok(applyEditStub.notCalled, 'applyEdit should not be called when there is no diff');
    });

    test('should write to file when document is not open', async () => {
      // Given
      const fs = require('fs');
      const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
      const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
      sandbox.stub(vscode.workspace, 'textDocuments').value([]);

      // When
      await handler.handleUpdateShaderSource({ code: 'new shader code', path: '/path/to/shader.glsl' });

      // Then
      assert.ok(writeFileSyncStub.calledOnce, 'writeFileSync should be called once');
      assert.strictEqual(writeFileSyncStub.firstCall.args[0], '/path/to/shader.glsl');
      assert.strictEqual(writeFileSyncStub.firstCall.args[1], 'new shader code');
      assert.strictEqual(writeFileSyncStub.firstCall.args[2], 'utf-8');
      assert.ok(executeCommandStub.calledOnceWith('shader-studio.refreshSpecificShaderByPath', '/path/to/shader.glsl'));
    });

    test('should not refresh via command when document is already open', async () => {
      const mockDoc = {
        uri: vscode.Uri.file('/path/to/shader.glsl'),
        getText: sandbox.stub().returns('old shader code'),
        positionAt: sandbox.stub().callsFake((offset: number) => new vscode.Position(0, offset)),
      };
      const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
      sandbox.stub(vscode.workspace, 'textDocuments').value([mockDoc]);
      sandbox.stub(vscode.workspace, 'applyEdit').resolves(true);

      await handler.handleUpdateShaderSource({ code: 'new shader code', path: '/path/to/shader.glsl' });

      assert.ok(executeCommandStub.notCalled);
    });

    test('should return early when path is missing', async () => {
      // Given
      const fs = require('fs');
      const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
      const applyEditStub = sandbox.stub(vscode.workspace, 'applyEdit');

      // When
      await handler.handleUpdateShaderSource({ code: 'some code', path: '' });

      // Then
      assert.ok(writeFileSyncStub.notCalled, 'writeFileSync should not be called');
      assert.ok(applyEditStub.notCalled, 'applyEdit should not be called');
    });

    test('should return early when code is missing', async () => {
      // Given
      const fs = require('fs');
      const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
      const applyEditStub = sandbox.stub(vscode.workspace, 'applyEdit');

      // When
      await handler.handleUpdateShaderSource({ code: '', path: '/path/to/shader.glsl' });

      // Then
      assert.ok(writeFileSyncStub.notCalled, 'writeFileSync should not be called');
      assert.ok(applyEditStub.notCalled, 'applyEdit should not be called');
    });

    test('should handle errors gracefully', async () => {
      // Given
      const fs = require('fs');
      sandbox.stub(fs, 'writeFileSync').throws(new Error('Disk full'));
      sandbox.stub(vscode.workspace, 'textDocuments').value([]);

      // When / Then - should not throw
      await handler.handleUpdateShaderSource({ code: 'new shader code', path: '/path/to/shader.glsl' });
    });
  });

  suite('getMinimalReplacement', () => {
    test('returns only the changed span for a small inline edit', () => {
      const mockDoc = {
        positionAt: (offset: number) => new vscode.Position(0, offset),
      } as any;

      const result = (handler as any).getMinimalReplacement(
        mockDoc,
        'abcdef',
        'abZdef',
      );

      assert.deepStrictEqual(result.range, new vscode.Range(0, 2, 0, 3));
      assert.strictEqual(result.text, 'Z');
    });

    test('returns the appended text for an insertion at the end', () => {
      const mockDoc = {
        positionAt: (offset: number) => new vscode.Position(0, offset),
      } as any;

      const result = (handler as any).getMinimalReplacement(
        mockDoc,
        'abc',
        'abcdef',
      );

      assert.deepStrictEqual(result.range, new vscode.Range(0, 3, 0, 3));
      assert.strictEqual(result.text, 'def');
    });
  });

  suite('handleRequestFileContents', () => {
    let respondFn: sinon.SinonStub;

    setup(() => {
      respondFn = sandbox.stub();
    });

    test('should send file contents when config and buffer file exist', async () => {
      // Given
      const fs = require('fs');
      const existsSyncStub = sandbox.stub(fs, 'existsSync');
      existsSyncStub.withArgs('/path/to/shader.sha.json').returns(true);
      existsSyncStub.withArgs('/path/to/buffer.glsl').returns(true);

      sandbox.stub(fs, 'readFileSync')
        .withArgs('/path/to/shader.sha.json', 'utf-8').returns(JSON.stringify({
          passes: {
            'BufferA': { path: 'buffer.glsl' },
          },
        }))
        .withArgs('/path/to/buffer.glsl', 'utf-8').returns('buffer shader code');

      sandbox.stub(vscode.workspace, 'textDocuments').value([]);

      // When
      await handler.handleRequestFileContents(
        { bufferName: 'BufferA', shaderPath: '/path/to/shader.glsl' },
        respondFn,
      );

      // Then
      assert.ok(respondFn.calledOnce, 'respondFn should be called once');
      const message = respondFn.firstCall.args[0];
      assert.strictEqual(message.type, 'fileContents');
      assert.strictEqual(message.payload.code, 'buffer shader code');
      assert.strictEqual(message.payload.bufferName, 'BufferA');
      assert.strictEqual(message.payload.path, '/path/to/buffer.glsl');
    });

    test('should return early when bufferName is missing', async () => {
      // Given / When
      await handler.handleRequestFileContents(
        { bufferName: '', shaderPath: '/path/to/shader.glsl' },
        respondFn,
      );

      // Then
      assert.ok(respondFn.notCalled, 'respondFn should not be called');
    });

    test('should return early when shaderPath is missing', async () => {
      // Given / When
      await handler.handleRequestFileContents(
        { bufferName: 'BufferA', shaderPath: '' },
        respondFn,
      );

      // Then
      assert.ok(respondFn.notCalled, 'respondFn should not be called');
    });

    test('should return early when config file does not exist', async () => {
      // Given
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);

      // When
      await handler.handleRequestFileContents(
        { bufferName: 'BufferA', shaderPath: '/path/to/shader.glsl' },
        respondFn,
      );

      // Then
      assert.ok(respondFn.notCalled, 'respondFn should not be called');
    });

    test('should return early when buffer has no path in config', async () => {
      // Given
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'readFileSync')
        .withArgs('/path/to/shader.sha.json', 'utf-8').returns(JSON.stringify({
          passes: {
            'BufferA': { /* no path */ },
          },
        }));

      // When
      await handler.handleRequestFileContents(
        { bufferName: 'BufferA', shaderPath: '/path/to/shader.glsl' },
        respondFn,
      );

      // Then
      assert.ok(respondFn.notCalled, 'respondFn should not be called');
    });

    test('should send empty code when buffer file does not exist', async () => {
      // Given
      const fs = require('fs');
      const existsSyncStub = sandbox.stub(fs, 'existsSync');
      existsSyncStub.withArgs('/path/to/shader.sha.json').returns(true);
      existsSyncStub.withArgs('/path/to/buffer.glsl').returns(false);

      sandbox.stub(fs, 'readFileSync')
        .withArgs('/path/to/shader.sha.json', 'utf-8').returns(JSON.stringify({
          passes: {
            'BufferA': { path: 'buffer.glsl' },
          },
        }));

      // When
      await handler.handleRequestFileContents(
        { bufferName: 'BufferA', shaderPath: '/path/to/shader.glsl' },
        respondFn,
      );

      // Then
      assert.ok(respondFn.calledOnce, 'respondFn should be called once');
      const message = respondFn.firstCall.args[0];
      assert.strictEqual(message.type, 'fileContents');
      assert.strictEqual(message.payload.code, '');
      assert.strictEqual(message.payload.bufferName, 'BufferA');
      assert.strictEqual(message.payload.path, '/path/to/buffer.glsl');
    });

    test('should prefer open document over file on disk', async () => {
      // Given
      const fs = require('fs');
      const existsSyncStub = sandbox.stub(fs, 'existsSync');
      existsSyncStub.withArgs('/path/to/shader.sha.json').returns(true);
      existsSyncStub.withArgs('/path/to/buffer.glsl').returns(true);

      sandbox.stub(fs, 'readFileSync')
        .withArgs('/path/to/shader.sha.json', 'utf-8').returns(JSON.stringify({
          passes: {
            'BufferA': { path: 'buffer.glsl' },
          },
        }));

      const mockDoc = {
        uri: vscode.Uri.file('/path/to/buffer.glsl'),
        getText: sandbox.stub().returns('in-memory buffer code'),
      };
      sandbox.stub(vscode.workspace, 'textDocuments').value([mockDoc]);

      // When
      await handler.handleRequestFileContents(
        { bufferName: 'BufferA', shaderPath: '/path/to/shader.glsl' },
        respondFn,
      );

      // Then
      assert.ok(respondFn.calledOnce, 'respondFn should be called once');
      const message = respondFn.firstCall.args[0];
      assert.strictEqual(message.type, 'fileContents');
      assert.strictEqual(message.payload.code, 'in-memory buffer code');
      assert.strictEqual(message.payload.bufferName, 'BufferA');
    });
  });
});
