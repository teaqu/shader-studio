import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { NavigationHandler } from '../../../app/handlers/NavigationHandler';
import { Logger } from '../../../app/services/Logger';

suite('NavigationHandler Test Suite', () => {
  let handler: NavigationHandler;
  let sandbox: sinon.SinonSandbox;
  let mockGlslFileTracker: any;
  let getPanelColumns: sinon.SinonStub;
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

    getPanelColumns = sandbox.stub().returns(new Set<vscode.ViewColumn>());

    handler = new NavigationHandler(
      mockGlslFileTracker,
      getPanelColumns,
      logger,
    );
  });

  teardown(() => {
    sandbox.restore();
    (Logger as any).instance = undefined;
  });

  test('can be instantiated', () => {
    assert.ok(handler instanceof NavigationHandler);
  });

  suite('handleNavigateToBuffer', () => {
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

      await handler.handleNavigateToBuffer({
        bufferPath: '/test/bufferA.glsl',
        shaderPath: '/test/shader.glsl',
      });

      assert.ok(showTextDocStub.calledOnce);
      const [uri, opts] = showTextDocStub.firstCall.args as [vscode.Uri, vscode.TextDocumentShowOptions];
      assert.ok(uri instanceof vscode.Uri);
      assert.strictEqual(uri.fsPath, '/test/bufferA.glsl');
      assert.strictEqual(opts.preview, false);
      assert.strictEqual(opts.preserveFocus, true);
    });

    test('skips navigation when navigateOnBufferSwitch is disabled', async () => {
      sandbox.stub(vscode.workspace, 'getConfiguration').returns({
        get: sandbox.stub().returns(false),
      } as any);
      const showTextDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

      await handler.handleNavigateToBuffer({
        bufferPath: '/test/bufferA.glsl',
        shaderPath: '/test/shader.glsl',
      });

      assert.ok(showTextDocStub.notCalled);
    });

    test('skips navigation when bufferPath is empty', async () => {
      sandbox.stub(vscode.workspace, 'getConfiguration').returns({
        get: sandbox.stub().returns(true),
      } as any);
      const showTextDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

      await handler.handleNavigateToBuffer({
        bufferPath: '',
        shaderPath: '/test/shader.glsl',
      });

      assert.ok(showTextDocStub.notCalled);
    });

    test('skips navigation when file does not exist', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      sandbox.stub(vscode.workspace, 'getConfiguration').returns({
        get: sandbox.stub().returns(true),
      } as any);
      const showTextDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

      await handler.handleNavigateToBuffer({
        bufferPath: '/test/missing.glsl',
        shaderPath: '/test/shader.glsl',
      });

      assert.ok(showTextDocStub.notCalled);
    });
  });

  suite('handleGoToLine', () => {
    test('opens document and moves cursor to the specified line', async () => {
      const mockDoc = {} as any;
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDoc);
      const mockEditor = {
        selection: new vscode.Selection(0, 0, 0, 0),
        revealRange: sandbox.stub(),
      } as any;
      sandbox.stub(vscode.window, 'showTextDocument').resolves(mockEditor);

      await handler.handleGoToLine({ line: 42, filePath: '/test/shader.glsl' });

      assert.strictEqual(mockEditor.selection.active.line, 42);
      assert.strictEqual(mockEditor.selection.active.character, 0);
      assert.ok(mockEditor.revealRange.calledOnce);
    });

    test('returns early without opening document when filePath is empty', async () => {
      const openDocStub = sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);

      await handler.handleGoToLine({ line: 5, filePath: '' });

      assert.ok(openDocStub.notCalled);
    });

    test('does not throw when showTextDocument rejects', async () => {
      sandbox.stub(vscode.workspace, 'openTextDocument').rejects(new Error('File not found'));

      await assert.doesNotReject(
        handler.handleGoToLine({ line: 1, filePath: '/test/missing.glsl' }),
      );
    });
  });

  suite('resolveTargetColumn', () => {
    test('returns column of tab group that contains the shader file', () => {
      sandbox.stub(vscode.window, 'tabGroups').value({
        all: [
          {
            viewColumn: vscode.ViewColumn.Two,
            tabs: [
              {
                input: { uri: vscode.Uri.file('/test/shader.glsl') },
              },
            ],
          },
        ],
      });
      getPanelColumns.returns(new Set<vscode.ViewColumn>());

      const result = handler.resolveTargetColumn('/test/shader.glsl');

      assert.strictEqual(result, vscode.ViewColumn.Two);
    });

    test('returns first non-panel column when shader is not found in any tab', () => {
      sandbox.stub(vscode.window, 'tabGroups').value({
        all: [
          { viewColumn: vscode.ViewColumn.One, tabs: [] },
          { viewColumn: vscode.ViewColumn.Two, tabs: [] },
        ],
      });
      // Mark ViewColumn.One as a panel column
      getPanelColumns.returns(new Set([vscode.ViewColumn.One]));

      const result = handler.resolveTargetColumn('/test/shader.glsl');

      assert.strictEqual(result, vscode.ViewColumn.Two);
    });

    test('falls back to ViewColumn.One when all groups are panel columns', () => {
      sandbox.stub(vscode.window, 'tabGroups').value({
        all: [{ viewColumn: vscode.ViewColumn.One, tabs: [] }],
      });
      getPanelColumns.returns(new Set([vscode.ViewColumn.One]));

      const result = handler.resolveTargetColumn('/test/shader.glsl');

      assert.strictEqual(result, vscode.ViewColumn.One);
    });

    test('skips panel columns when searching for shader tab', () => {
      sandbox.stub(vscode.window, 'tabGroups').value({
        all: [
          {
            viewColumn: vscode.ViewColumn.One,
            tabs: [
              { input: { uri: vscode.Uri.file('/test/shader.glsl') } },
            ],
          },
          {
            viewColumn: vscode.ViewColumn.Two,
            tabs: [],
          },
        ],
      });
      // ViewColumn.One is a panel column, so the shader tab there should be skipped
      getPanelColumns.returns(new Set([vscode.ViewColumn.One]));

      const result = handler.resolveTargetColumn('/test/shader.glsl');

      // Should fall through to the first non-panel column (Two), not One
      assert.strictEqual(result, vscode.ViewColumn.Two);
    });

    test('returns ViewColumn.One when there are no tab groups', () => {
      sandbox.stub(vscode.window, 'tabGroups').value({ all: [] });
      getPanelColumns.returns(new Set<vscode.ViewColumn>());

      const result = handler.resolveTargetColumn('/test/shader.glsl');

      assert.strictEqual(result, vscode.ViewColumn.One);
    });
  });
});
