import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as sinon from 'sinon';
import { ClientMessageHandler } from '../../app/ClientMessageHandler';
import { WorkspaceFileScanner } from '../../app/WorkspaceFileScanner';
import { Logger } from '../../app/services/Logger';

suite('ClientMessageHandler Test Suite', () => {
  let handler: ClientMessageHandler;
  let sandbox: sinon.SinonSandbox;
  let mockContext: vscode.ExtensionContext;
  let mockShaderProvider: any;
  let mockGlslFileTracker: any;
  let mockMessenger: any;
  let respondFn: sinon.SinonStub;

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

    mockContext = {
      extensionPath: path.join(__dirname, 'mock-extension'),
      workspaceState: {
        get: sandbox.stub().returns(null),
        update: sandbox.stub().resolves(),
      },
      subscriptions: [],
    } as any;

    mockShaderProvider = {
      sendShaderFromEditor: sandbox.stub(),
      sendShaderFromPath: sandbox.stub().resolves(),
      updateScriptPollingRate: sandbox.stub(),
      resetScriptTime: sandbox.stub(),
    } as any;

    mockGlslFileTracker = {
      getActiveOrLastViewedGLSLEditor: sandbox.stub().returns(null),
    } as any;

    mockMessenger = {
      send: sandbox.stub(),
    } as any;

    respondFn = sandbox.stub();

    sandbox.stub(vscode.commands, 'executeCommand').resolves();

    handler = new ClientMessageHandler(
      mockContext,
      mockShaderProvider,
      mockGlslFileTracker,
      mockMessenger,
      mockContext.extensionPath,
    );
  });

  teardown(() => {
    sandbox.restore();
    (Logger as any).instance = undefined;
  });

  test('can be instantiated', () => {
    assert.ok(handler instanceof ClientMessageHandler);
  });

  suite('updateConfig', () => {
    test('writes config file and triggers shader refresh', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');
      mockShaderProvider.sendShaderFromPath = sandbox.stub();

      await handler.handle(
        { type: 'updateConfig', payload: { config: {}, text: '{}', shaderPath: '/test/shader.glsl' } },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
      assert.strictEqual(writeStub.firstCall.args[0], '/test/shader.sha.json');
      assert.strictEqual(writeStub.firstCall.args[1], '{}');
    });

    test('skips shader refresh when skipRefresh is true', async () => {
      const clock = sandbox.useFakeTimers();
      const fs = require('fs');
      sandbox.stub(fs, 'writeFileSync');
      mockShaderProvider.sendShaderFromPath = sandbox.stub();

      await handler.handle(
        { type: 'updateConfig', payload: { config: {}, text: '{}', shaderPath: '/test/shader.glsl', skipRefresh: true } },
        respondFn,
      );

      clock.tick(200);
      assert.ok(!mockShaderProvider.sendShaderFromPath.called);
      clock.restore();
    });

    test('sends error to messenger when write fails', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'writeFileSync').throws(new Error('Disk full'));
      mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns({
        document: { uri: { fsPath: '/test/shader.glsl' } },
      });

      await handler.handle(
        { type: 'updateConfig', payload: { config: {}, text: '{}' } },
        respondFn,
      );

      assert.ok((mockMessenger.send as sinon.SinonStub).calledOnce);
      const msg = (mockMessenger.send as sinon.SinonStub).firstCall.args[0];
      assert.strictEqual(msg.type, 'error');
    });
  });

  suite('selectFile', () => {
    test('responds with fileSelected when dialog confirms', async () => {
      const selectedUri = vscode.Uri.file('/test/selected.glsl');
      sandbox.stub(vscode.window, 'showOpenDialog').resolves([selectedUri]);

      await handler.handle(
        { type: 'selectFile', payload: { shaderPath: '/test/shader.glsl', fileType: 'glsl', requestId: 'req1' } },
        respondFn,
      );

      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'fileSelected');
      assert.strictEqual(msg.payload.requestId, 'req1');
      assert.ok(msg.payload.path.includes('selected.glsl'));
    });

    test('does not respond when dialog is cancelled', async () => {
      sandbox.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      await handler.handle(
        { type: 'selectFile', payload: { shaderPath: '/test/shader.glsl', fileType: 'glsl', requestId: 'req1' } },
        respondFn,
      );

      assert.ok(respondFn.notCalled);
    });

    test('calls writeWorkspaceTypeDefs when script .ts file is selected', async () => {
      const WorkspaceTypeDefs = require('../../app/WorkspaceTypeDefs');
      const writeStub = sandbox.stub(WorkspaceTypeDefs, 'writeWorkspaceTypeDefs');

      const selectedUri = vscode.Uri.file('/test/shader.uniforms.ts');
      sandbox.stub(vscode.window, 'showOpenDialog').resolves([selectedUri]);

      await handler.handle(
        { type: 'selectFile', payload: { shaderPath: '/test/shader.glsl', fileType: 'script', requestId: 'req1' } },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
    });
  });

  suite('createFile', () => {
    test('responds with fileSelected after creating a new file', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      const savedUri = vscode.Uri.file('/test/newbuffer.glsl');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handle(
        { type: 'createFile', payload: { shaderPath: '/test/shader.glsl', suggestedPath: 'newbuffer.glsl', fileType: 'glsl', requestId: 'req2' } },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'fileSelected');
      assert.strictEqual(msg.payload.requestId, 'req2');
    });

    test('does not write file when it already exists', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      const savedUri = vscode.Uri.file('/test/existing.glsl');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handle(
        { type: 'createFile', payload: { shaderPath: '/test/shader.glsl', suggestedPath: 'existing.glsl', fileType: 'glsl', requestId: 'req3' } },
        respondFn,
      );

      assert.ok(writeStub.notCalled);
      assert.ok(respondFn.calledOnce);
    });

    test('calls writeWorkspaceTypeDefs when creating script .ts file', async () => {
      const WorkspaceTypeDefs = require('../../app/WorkspaceTypeDefs');
      const writeTypeDefsStub = sandbox.stub(WorkspaceTypeDefs, 'writeWorkspaceTypeDefs');

      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      sandbox.stub(fs, 'writeFileSync');

      const savedUri = vscode.Uri.file('/test/shader.uniforms.ts');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handle(
        { type: 'createFile', payload: { shaderPath: '/test/shader.glsl', suggestedPath: 'shader.uniforms.ts', fileType: 'script', requestId: 'req4' } },
        respondFn,
      );

      assert.ok(writeTypeDefsStub.calledOnce);
    });
  });

  suite('updateShaderSource', () => {
    test('delegates to overlayHandler', async () => {
      const overlayHandler = handler.overlay;
      const handleStub = sandbox.stub(overlayHandler, 'handleUpdateShaderSource').resolves();

      await handler.handle(
        { type: 'updateShaderSource', payload: { code: 'void main() {}', path: '/test/shader.glsl' } },
        respondFn,
      );

      assert.ok(handleStub.calledOnce);
      assert.deepStrictEqual(handleStub.firstCall.args[0], { code: 'void main() {}', path: '/test/shader.glsl' });
    });
  });

  suite('requestFileContents', () => {
    test('delegates to overlayHandler with respondFn', async () => {
      const overlayHandler = handler.overlay;
      const handleStub = sandbox.stub(overlayHandler, 'handleRequestFileContents').resolves();

      await handler.handle(
        { type: 'requestFileContents', payload: { bufferName: 'BufferA', shaderPath: '/test/shader.glsl' } },
        respondFn,
      );

      assert.ok(handleStub.calledOnce);
      assert.deepStrictEqual(handleStub.firstCall.args[0], { bufferName: 'BufferA', shaderPath: '/test/shader.glsl' });
      assert.strictEqual(typeof handleStub.firstCall.args[1], 'function');
    });
  });

  suite('navigateToBuffer', () => {
    test('opens buffer file in VS Code editor', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(vscode.workspace, 'getConfiguration').returns({
        get: sandbox.stub().withArgs('navigateOnBufferSwitch', true).returns(true),
      } as any);
      sandbox.stub(vscode.window, 'tabGroups').value({
        all: [{ viewColumn: vscode.ViewColumn.One, tabs: [] }],
      });
      const showTextDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

      await handler.handle(
        { type: 'navigateToBuffer', payload: { bufferPath: '/test/bufferA.glsl', shaderPath: '/test/shader.glsl' } },
        respondFn,
      );

      assert.ok(showTextDocStub.calledOnce);
    });

    test('skips when navigateOnBufferSwitch is disabled', async () => {
      sandbox.stub(vscode.workspace, 'getConfiguration').returns({
        get: sandbox.stub().returns(false),
      } as any);
      const showTextDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

      await handler.handle(
        { type: 'navigateToBuffer', payload: { bufferPath: '/test/bufferA.glsl', shaderPath: '/test/shader.glsl' } },
        respondFn,
      );

      assert.ok(showTextDocStub.notCalled);
    });
  });

  suite('requestWorkspaceFiles', () => {
    test('calls scanner and responds via respondFn', async () => {
      const mockFiles = [
        { name: 'texture.png', workspacePath: '@/texture.png', thumbnailUri: '/texture.png', isSameDirectory: true },
      ];
      const scanStub = sandbox.stub(WorkspaceFileScanner, 'scanFiles').resolves(mockFiles);

      await handler.handle(
        { type: 'requestWorkspaceFiles', payload: { extensions: ['png'], shaderPath: '/test/shader.glsl' } },
        respondFn,
      );

      assert.ok(scanStub.calledOnce);
      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'workspaceFiles');
      assert.strictEqual(msg.payload.files.length, 1);
    });

    test('uses pathConverter for file URIs', async () => {
      let capturedConverter: ((p: string) => string) | undefined;
      sandbox.stub(WorkspaceFileScanner, 'scanFiles').callsFake(async (_ext, _path, converter) => {
        capturedConverter = converter;
        return [];
      });

      const customConverter = (p: string) => `http://example.com/${p}`;

      await handler.handle(
        { type: 'requestWorkspaceFiles', payload: { extensions: ['png'], shaderPath: '/test/shader.glsl' } },
        respondFn,
        customConverter,
      );

      assert.ok(capturedConverter);
      assert.strictEqual(capturedConverter!('/path/to/file.png'), 'http://example.com//path/to/file.png');
    });

    test('responds with empty files array on error', async () => {
      sandbox.stub(WorkspaceFileScanner, 'scanFiles').rejects(new Error('scan error'));

      await handler.handle(
        { type: 'requestWorkspaceFiles', payload: { extensions: ['png'], shaderPath: '/test/shader.glsl' } },
        respondFn,
      );

      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'workspaceFiles');
      assert.deepStrictEqual(msg.payload.files, []);
    });
  });

  suite('forkShader', () => {
    test('copies shader and opens new document', async () => {
      const fs = require('fs');
      const existsStub = sandbox.stub(fs, 'existsSync');
      existsStub.withArgs('/test/shader.glsl').returns(true);
      existsStub.withArgs('/test/shader.1.glsl').returns(false);
      existsStub.withArgs('/test/shader.sha.json').returns(false);
      const copyStub = sandbox.stub(fs, 'copyFileSync');

      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file('/test/shader.1.glsl'));
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
      sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
      sandbox.stub(vscode.window, 'tabGroups').value({ all: [{ viewColumn: vscode.ViewColumn.One, tabs: [] }] });

      await handler.handle(
        { type: 'forkShader', payload: { shaderPath: '/test/shader.glsl' } },
        respondFn,
      );

      assert.ok(copyStub.calledOnce);
    });

    test('does nothing when shaderPath is empty', async () => {
      const fs = require('fs');
      const copyStub = sandbox.stub(fs, 'copyFileSync');
      const showSaveStub = sandbox.stub(vscode.window, 'showSaveDialog');

      await handler.handle(
        { type: 'forkShader', payload: { shaderPath: '' } },
        respondFn,
      );

      assert.ok(showSaveStub.notCalled);
      assert.ok(copyStub.notCalled);
    });
  });

  suite('saveFile', () => {
    test('saves file and responds with success', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file('/test/output.gif'));

      await handler.handle(
        {
          type: 'saveFile',
          payload: {
            data: Buffer.from('fake data').toString('base64'),
            defaultName: '/test/output.gif',
            filters: { 'GIF': ['gif'] },
          },
        },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'saveFileResult');
      assert.strictEqual(msg.payload.success, true);
    });

    test('responds with cancelled when dialog is dismissed', async () => {
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

      await handler.handle(
        { type: 'saveFile', payload: { data: '', defaultName: 'output.gif', filters: { 'GIF': ['gif'] } } },
        respondFn,
      );

      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'saveFileResult');
      assert.strictEqual(msg.payload.success, false);
    });
  });

  suite('goToLine', () => {
    test('opens document and sets cursor position', async () => {
      const mockDoc = {} as any;
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDoc);
      const mockEditor = {
        selection: new vscode.Selection(0, 0, 0, 0),
        revealRange: sandbox.stub(),
      } as any;
      sandbox.stub(vscode.window, 'showTextDocument').resolves(mockEditor);

      await handler.handle(
        { type: 'goToLine', payload: { line: 42, filePath: '/test/shader.glsl' } },
        respondFn,
      );

      assert.strictEqual(mockEditor.selection.active.line, 42);
    });

    test('does nothing when filePath is empty', async () => {
      const openDocStub = sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);

      await handler.handle(
        { type: 'goToLine', payload: { line: 0, filePath: '' } },
        respondFn,
      );

      assert.ok(openDocStub.notCalled);
    });
  });

  suite('extensionCommand', () => {
    test('executes extension command via vscode.commands.executeCommand', async () => {
      const execStub = vscode.commands.executeCommand as sinon.SinonStub;

      await handler.handle(
        { type: 'extensionCommand', payload: { command: 'refreshCurrentShader' } },
        respondFn,
      );

      assert.ok(execStub.calledWith('shader-studio.refreshCurrentShader'));
    });

    test('does NOT handle moveToNewWindow (that is PanelManager-specific)', async () => {
      const execStub = vscode.commands.executeCommand as sinon.SinonStub;

      await handler.handle(
        { type: 'extensionCommand', payload: { command: 'moveToNewWindow' } },
        respondFn,
      );

      // moveToNewWindow should NOT trigger executeCommand from ClientMessageHandler
      assert.ok(execStub.notCalled);
    });
  });

  suite('setCompileMode', () => {
    test('executes setCompileMode via vscode.commands.executeCommand', async () => {
      const execStub = vscode.commands.executeCommand as sinon.SinonStub;

      await handler.handle(
        { type: 'setCompileMode', payload: { mode: 'manual' } },
        respondFn,
      );

      assert.ok(execStub.calledWith('shader-studio.setCompileMode', 'manual'));
    });
  });

  suite('updateScriptPollingRate', () => {
    test('calls shaderProvider.updateScriptPollingRate with fps', async () => {
      await handler.handle(
        { type: 'updateScriptPollingRate', payload: { fps: 30 } },
        respondFn,
      );

      assert.ok(mockShaderProvider.updateScriptPollingRate.calledOnceWith(30));
    });

    test('does nothing for invalid fps', async () => {
      await handler.handle(
        { type: 'updateScriptPollingRate', payload: { fps: -1 } },
        respondFn,
      );

      assert.ok(mockShaderProvider.updateScriptPollingRate.notCalled);
    });
  });

  suite('resetScriptTime', () => {
    test('calls shaderProvider.resetScriptTime', async () => {
      await handler.handle(
        { type: 'resetScriptTime' },
        respondFn,
      );

      assert.ok(mockShaderProvider.resetScriptTime.calledOnce);
    });
  });

  suite('saveLayout', () => {
    test('delegates layout persistence', async () => {
      const layoutPayload = { layoutSlot: 'vscode:2', state: { activeLayout: { state: 'some-layout-data' }, panelSnapshots: {} } };
      const saveStub = sandbox.stub((handler as any).layoutStateStore, 'save').resolves();

      await handler.handle(
        { type: 'saveLayout', payload: layoutPayload },
        respondFn,
      );

      assert.ok(saveStub.calledOnceWithExactly('vscode:2', layoutPayload.state));
    });
  });

  suite('requestLayout', () => {
    test('loads from the layout store and responds with restoreLayout', async () => {
      const savedLayout = { activeLayout: { state: 'saved-layout' }, panelSnapshots: {} };
      const loadStub = sandbox.stub((handler as any).layoutStateStore, 'load').returns(savedLayout);

      await handler.handle(
        { type: 'requestLayout', payload: { layoutSlot: 'vscode:2' } },
        respondFn,
      );

      assert.ok(loadStub.calledOnceWithExactly('vscode:2'));
      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'restoreLayout');
      assert.deepStrictEqual(msg.payload, { layoutSlot: 'vscode:2', state: savedLayout });
    });

    test('responds with null when no layout is saved', async () => {
      sandbox.stub((handler as any).layoutStateStore, 'load').returns(null);

      await handler.handle(
        { type: 'requestLayout', payload: { layoutSlot: 'vscode:2' } },
        respondFn,
      );

      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'restoreLayout');
      assert.deepStrictEqual(msg.payload, { layoutSlot: 'vscode:2', state: null });
    });
  });

  suite('unknown message type', () => {
    test('does not throw and does not call respondFn', async () => {
      await assert.doesNotReject(
        handler.handle({ type: 'unknownType', payload: {} }, respondFn),
      );
      assert.ok(respondFn.notCalled);
    });
  });
});
