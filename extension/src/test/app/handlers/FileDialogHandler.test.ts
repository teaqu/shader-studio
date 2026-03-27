import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { FileDialogHandler } from '../../../app/handlers/FileDialogHandler';
import { Logger } from '../../../app/services/Logger';

suite('FileDialogHandler Test Suite', () => {
  let handler: FileDialogHandler;
  let sandbox: sinon.SinonSandbox;
  let mockContext: vscode.ExtensionContext;
  let mockGlslFileTracker: any;
  let mockMessenger: any;
  let resolveTargetColumn: sinon.SinonStub;
  let respondFn: sinon.SinonStub;
  let logger: Logger;

  const EXTENSION_PATH = '/mock/extension';

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

    mockContext = {
      extensionPath: EXTENSION_PATH,
      subscriptions: [],
    } as any;

    mockGlslFileTracker = {
      getActiveOrLastViewedGLSLEditor: sandbox.stub().returns(null),
    } as any;

    mockMessenger = {
      send: sandbox.stub(),
    } as any;

    resolveTargetColumn = sandbox.stub().returns(vscode.ViewColumn.One);
    respondFn = sandbox.stub();

    handler = new FileDialogHandler(
      mockContext,
      mockGlslFileTracker,
      EXTENSION_PATH,
      mockMessenger,
      resolveTargetColumn,
      logger,
    );
  });

  teardown(() => {
    sandbox.restore();
    (Logger as any).instance = undefined;
  });

  test('can be instantiated', () => {
    assert.ok(handler instanceof FileDialogHandler);
  });

  suite('handleSelectFile', () => {
    test('responds with fileSelected when a file is chosen', async () => {
      const selectedUri = vscode.Uri.file('/test/bufferA.glsl');
      sandbox.stub(vscode.window, 'showOpenDialog').resolves([selectedUri]);

      await handler.handleSelectFile(
        { shaderPath: '/test/shader.glsl', fileType: 'glsl', requestId: 'req1' },
        respondFn,
      );

      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'fileSelected');
      assert.strictEqual(msg.payload.requestId, 'req1');
      assert.ok(msg.payload.path.includes('bufferA.glsl'));
    });

    test('does not call respondFn when dialog is cancelled', async () => {
      sandbox.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      await handler.handleSelectFile(
        { shaderPath: '/test/shader.glsl', fileType: 'glsl', requestId: 'req1' },
        respondFn,
      );

      assert.ok(respondFn.notCalled);
    });

    test('does not call respondFn when dialog returns empty array', async () => {
      sandbox.stub(vscode.window, 'showOpenDialog').resolves([]);

      await handler.handleSelectFile(
        { shaderPath: '/test/shader.glsl', fileType: 'glsl', requestId: 'req1' },
        respondFn,
      );

      assert.ok(respondFn.notCalled);
    });

    test('passes script filters when fileType is script', async () => {
      const showOpenStub = sandbox.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      await handler.handleSelectFile(
        { shaderPath: '/test/shader.glsl', fileType: 'script', requestId: 'req1' },
        respondFn,
      );

      assert.ok(showOpenStub.calledOnce);
      const opts = showOpenStub.firstCall.args[0]!;
      assert.deepStrictEqual(opts.filters, { 'Script files': ['ts', 'js'] });
    });

    test('calls writeWorkspaceTypeDefs when a .ts script file is selected', async () => {
      const WorkspaceTypeDefs = require('../../../app/WorkspaceTypeDefs');
      const writeStub = sandbox.stub(WorkspaceTypeDefs, 'writeWorkspaceTypeDefs');

      const selectedUri = vscode.Uri.file('/test/shader.uniforms.ts');
      sandbox.stub(vscode.window, 'showOpenDialog').resolves([selectedUri]);

      await handler.handleSelectFile(
        { shaderPath: '/test/shader.glsl', fileType: 'script', requestId: 'req1' },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
    });

    test('does not call writeWorkspaceTypeDefs when a .js script file is selected', async () => {
      const WorkspaceTypeDefs = require('../../../app/WorkspaceTypeDefs');
      const writeStub = sandbox.stub(WorkspaceTypeDefs, 'writeWorkspaceTypeDefs');

      const selectedUri = vscode.Uri.file('/test/shader.uniforms.js');
      sandbox.stub(vscode.window, 'showOpenDialog').resolves([selectedUri]);

      await handler.handleSelectFile(
        { shaderPath: '/test/shader.glsl', fileType: 'script', requestId: 'req1' },
        respondFn,
      );

      assert.ok(writeStub.notCalled);
    });

    test('uses active editor directory when shaderPath is empty', async () => {
      mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns({
        document: { uri: { fsPath: '/active/shader.glsl' } },
      });
      const showOpenStub = sandbox.stub(vscode.window, 'showOpenDialog').resolves(undefined);

      await handler.handleSelectFile(
        { shaderPath: '', fileType: 'glsl', requestId: 'req1' },
        respondFn,
      );

      assert.ok(showOpenStub.calledOnce);
      const opts = showOpenStub.firstCall.args[0]!;
      assert.ok(opts.defaultUri);
      assert.ok((opts.defaultUri as vscode.Uri).fsPath.includes('active'));
    });

    test('produces relative path when file is in shader subtree', async () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: '/workspace' } }]);
      const selectedUri = vscode.Uri.file('/test/textures/image.png');
      sandbox.stub(vscode.window, 'showOpenDialog').resolves([selectedUri]);

      await handler.handleSelectFile(
        { shaderPath: '/test/shader.glsl', fileType: 'glsl', requestId: 'req1' },
        respondFn,
      );

      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.payload.path, './textures/image.png');
    });
  });

  suite('resolveOutputPath', () => {
    const shaderDir = '/workspace/shaders';

    test('returns relative path for file in shader subdirectory', () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: '/workspace' } }]);
      const result = handler.resolveOutputPath('/workspace/shaders/textures/img.png', shaderDir);
      assert.strictEqual(result, './textures/img.png');
    });

    test('returns relative path for file in same directory as shader', () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: '/workspace' } }]);
      const result = handler.resolveOutputPath('/workspace/shaders/img.png', shaderDir);
      assert.strictEqual(result, './img.png');
    });

    test('returns @/ path for file elsewhere in workspace', () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: '/workspace' } }]);
      const result = handler.resolveOutputPath('/workspace/shared/textures/img.png', shaderDir);
      assert.strictEqual(result, '@/shared/textures/img.png');
    });

    test('returns absolute path for file outside workspace', () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: '/workspace' } }]);
      const result = handler.resolveOutputPath('/other/project/img.png', shaderDir);
      assert.strictEqual(result, '/other/project/img.png');
    });

    test('returns absolute path when there is no workspace', () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
      const result = handler.resolveOutputPath('/some/dir/img.png', shaderDir);
      assert.strictEqual(result, '/some/dir/img.png');
    });

    test('returns absolute path when shaderDir is null', () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: '/workspace' } }]);
      const result = handler.resolveOutputPath('/workspace/shaders/img.png', null);
      assert.strictEqual(result, '/workspace/shaders/img.png');
    });

    test('returns relative path for sibling file when no workspace', () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
      const result = handler.resolveOutputPath('/workspace/shaders/textures/img.png', shaderDir);
      assert.strictEqual(result, './textures/img.png');
    });

    test('returns absolute path for file above shader dir when no workspace', () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
      const result = handler.resolveOutputPath('/workspace/other/img.png', shaderDir);
      assert.strictEqual(result, '/workspace/other/img.png');
    });
  });

  suite('handleCreateFile', () => {
    test('creates a new GLSL file and responds with fileSelected', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      const savedUri = vscode.Uri.file('/test/newbuffer.glsl');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handleCreateFile(
        { shaderPath: '/test/shader.glsl', suggestedPath: 'newbuffer.glsl', fileType: 'glsl', requestId: 'req2' },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'fileSelected');
      assert.strictEqual(msg.payload.requestId, 'req2');
    });

    test('does not overwrite an already existing file', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(true);
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      const savedUri = vscode.Uri.file('/test/existing.glsl');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handleCreateFile(
        { shaderPath: '/test/shader.glsl', suggestedPath: 'existing.glsl', fileType: 'glsl', requestId: 'req3' },
        respondFn,
      );

      assert.ok(writeStub.notCalled);
      assert.ok(respondFn.calledOnce);
    });

    test('does not call respondFn when save dialog is cancelled', async () => {
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

      await handler.handleCreateFile(
        { shaderPath: '/test/shader.glsl', suggestedPath: 'newbuffer.glsl', fileType: 'glsl', requestId: 'req4' },
        respondFn,
      );

      assert.ok(respondFn.notCalled);
    });

    test('writes glsl-common template for glsl-common fileType', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      const savedUri = vscode.Uri.file('/test/common.glsl');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handleCreateFile(
        { shaderPath: '/test/shader.glsl', suggestedPath: 'common.glsl', fileType: 'glsl-common', requestId: 'req5' },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
      const content: string = writeStub.firstCall.args[1];
      assert.ok(content.includes('Common functions'));
    });

    test('writes default mainImage template for glsl fileType', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      const savedUri = vscode.Uri.file('/test/newbuffer.glsl');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handleCreateFile(
        { shaderPath: '/test/shader.glsl', suggestedPath: 'newbuffer.glsl', fileType: 'glsl', requestId: 'req6' },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
      const content: string = writeStub.firstCall.args[1];
      assert.ok(content.includes('mainImage'));
    });

    test('writes JS template for script .js fileType', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      const savedUri = vscode.Uri.file('/test/shader.uniforms.js');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handleCreateFile(
        { shaderPath: '/test/shader.glsl', suggestedPath: 'shader.uniforms.js', fileType: 'script', requestId: 'req7' },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
      const content: string = writeStub.firstCall.args[1];
      assert.ok(content.includes('export function uniforms'));
      assert.ok(!content.includes('<reference'));
    });

    test('writes TS template with reference when workspaceFolders is set', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: vscode.Uri.file('/workspace') },
      ]);

      const savedUri = vscode.Uri.file('/workspace/shaders/shader.uniforms.ts');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handleCreateFile(
        { shaderPath: '/workspace/shaders/shader.glsl', suggestedPath: 'shader.uniforms.ts', fileType: 'script', requestId: 'req8' },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
      const content: string = writeStub.firstCall.args[1];
      assert.ok(content.includes('/// <reference'));
      assert.ok(content.includes('shader-studio.d.ts'));
    });

    test('writes TS template without reference when workspaceFolders is empty', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      const writeStub = sandbox.stub(fs, 'writeFileSync');

      sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

      const savedUri = vscode.Uri.file('/test/shader.uniforms.ts');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handleCreateFile(
        { shaderPath: '/test/shader.glsl', suggestedPath: 'shader.uniforms.ts', fileType: 'script', requestId: 'req9' },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
      const content: string = writeStub.firstCall.args[1];
      assert.ok(content.includes('UniformContext'));
      assert.ok(!content.includes('/// <reference'));
    });

    test('calls writeWorkspaceTypeDefs when creating a .ts script file', async () => {
      const WorkspaceTypeDefs = require('../../../app/WorkspaceTypeDefs');
      const writeTypeDefsStub = sandbox.stub(WorkspaceTypeDefs, 'writeWorkspaceTypeDefs');

      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      sandbox.stub(fs, 'writeFileSync');
      sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

      const savedUri = vscode.Uri.file('/test/shader.uniforms.ts');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handleCreateFile(
        { shaderPath: '/test/shader.glsl', suggestedPath: 'shader.uniforms.ts', fileType: 'script', requestId: 'req10' },
        respondFn,
      );

      assert.ok(writeTypeDefsStub.calledOnce);
    });

    test('uses @/ path when created file is elsewhere in workspace', async () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: '/workspace' } }]);
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      sandbox.stub(fs, 'writeFileSync');

      const savedUri = vscode.Uri.file('/workspace/shared/common.glsl');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handleCreateFile(
        { shaderPath: '/workspace/shaders/shader.glsl', suggestedPath: 'common.glsl', fileType: 'glsl-common', requestId: 'req-ws' },
        respondFn,
      );

      assert.ok(respondFn.calledOnce);
      assert.strictEqual(respondFn.firstCall.args[0].payload.path, '@/shared/common.glsl');
    });

    test('uses absolute path when created file is outside workspace', async () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: '/workspace' } }]);
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      sandbox.stub(fs, 'writeFileSync');

      const savedUri = vscode.Uri.file('/other/dir/common.glsl');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(savedUri);

      await handler.handleCreateFile(
        { shaderPath: '/workspace/shaders/shader.glsl', suggestedPath: 'common.glsl', fileType: 'glsl-common', requestId: 'req-abs' },
        respondFn,
      );

      assert.ok(respondFn.calledOnce);
      assert.strictEqual(respondFn.firstCall.args[0].payload.path, '/other/dir/common.glsl');
    });
  });

  suite('handleSaveFile', () => {
    test('saves file and responds with success when dialog confirms', async () => {
      const fs = require('fs');
      const writeStub = sandbox.stub(fs, 'writeFileSync');
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file('/test/output.gif'));

      await handler.handleSaveFile(
        {
          data: Buffer.from('fake data').toString('base64'),
          defaultName: '/test/output.gif',
          filters: { 'GIF': ['gif'] },
        },
        respondFn,
      );

      assert.ok(writeStub.calledOnce);
      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'saveFileResult');
      assert.strictEqual(msg.payload.success, true);
      assert.ok(msg.payload.path.includes('output.gif'));
    });

    test('responds with cancelled result when dialog is dismissed', async () => {
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

      await handler.handleSaveFile(
        { data: '', defaultName: 'output.gif', filters: { 'GIF': ['gif'] } },
        respondFn,
      );

      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'saveFileResult');
      assert.strictEqual(msg.payload.success, false);
      assert.strictEqual(msg.payload.error, 'Cancelled');
    });

    test('responds with error result when writeFileSync throws', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'writeFileSync').throws(new Error('No space left'));
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file('/test/output.gif'));

      await handler.handleSaveFile(
        {
          data: Buffer.from('data').toString('base64'),
          defaultName: '/test/output.gif',
          filters: { 'GIF': ['gif'] },
        },
        respondFn,
      );

      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'saveFileResult');
      assert.strictEqual(msg.payload.success, false);
      assert.ok(msg.payload.error.includes('No space left'));
    });
  });

  suite('handleForkShader', () => {
    test('copies shader and opens the new document', async () => {
      const fs = require('fs');
      const existsStub = sandbox.stub(fs, 'existsSync');
      existsStub.withArgs('/test/shader.glsl').returns(true);
      existsStub.withArgs('/test/shader.1.glsl').returns(false);
      existsStub.withArgs('/test/shader.sha.json').returns(false);
      const copyStub = sandbox.stub(fs, 'copyFileSync');

      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file('/test/shader.1.glsl'));
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
      const showTextDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

      await handler.handleForkShader({ shaderPath: '/test/shader.glsl' });

      assert.ok(copyStub.calledOnce);
      assert.strictEqual(copyStub.firstCall.args[0], '/test/shader.glsl');
      assert.strictEqual(copyStub.firstCall.args[1], '/test/shader.1.glsl');
      assert.ok(showTextDocStub.calledOnce);
    });

    test('also copies companion .sha.json config when it exists', async () => {
      const fs = require('fs');
      const existsStub = sandbox.stub(fs, 'existsSync');
      existsStub.withArgs('/test/shader.glsl').returns(true);
      existsStub.withArgs('/test/shader.1.glsl').returns(false);
      existsStub.withArgs('/test/shader.sha.json').returns(true);
      const copyStub = sandbox.stub(fs, 'copyFileSync');

      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file('/test/shader.1.glsl'));
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
      sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

      await handler.handleForkShader({ shaderPath: '/test/shader.glsl' });

      // Should copy both the shader and the config
      assert.strictEqual(copyStub.callCount, 2);
      assert.ok(copyStub.args.some(([, dest]) => (dest as string).endsWith('.sha.json')));
    });

    test('increments counter to find a free filename', async () => {
      const fs = require('fs');
      const existsStub = sandbox.stub(fs, 'existsSync');
      existsStub.withArgs('/test/shader.glsl').returns(true);
      existsStub.withArgs('/test/shader.1.glsl').returns(true);  // already taken
      existsStub.withArgs('/test/shader.2.glsl').returns(false); // free
      existsStub.withArgs('/test/shader.sha.json').returns(false);
      sandbox.stub(fs, 'copyFileSync');

      const showSaveStub = sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

      await handler.handleForkShader({ shaderPath: '/test/shader.glsl' });

      assert.ok(showSaveStub.calledOnce);
      const opts = showSaveStub.firstCall.args[0]!;
      assert.ok((opts.defaultUri as vscode.Uri).fsPath.includes('shader.2.glsl'));
    });

    test('returns early when shaderPath is empty', async () => {
      const fs = require('fs');
      const existsStub = sandbox.stub(fs, 'existsSync').returns(false);
      const showSaveStub = sandbox.stub(vscode.window, 'showSaveDialog');

      await handler.handleForkShader({ shaderPath: '' });

      assert.ok(showSaveStub.notCalled);
      assert.ok(existsStub.notCalled);
    });

    test('returns early when save dialog is cancelled', async () => {
      const fs = require('fs');
      const existsStub = sandbox.stub(fs, 'existsSync');
      existsStub.withArgs('/test/shader.glsl').returns(true);
      existsStub.returns(false); // numbered variants are free
      const copyStub = sandbox.stub(fs, 'copyFileSync');

      sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

      await handler.handleForkShader({ shaderPath: '/test/shader.glsl' });

      assert.ok(copyStub.notCalled);
    });

    test('sends error to messenger when an exception is thrown', async () => {
      const fs = require('fs');
      const existsStub = sandbox.stub(fs, 'existsSync');
      existsStub.withArgs('/test/shader.glsl').returns(true);
      existsStub.returns(false); // numbered variants are free
      sandbox.stub(fs, 'copyFileSync').throws(new Error('Permission denied'));

      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file('/test/shader.1.glsl'));
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
      sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);

      await handler.handleForkShader({ shaderPath: '/test/shader.glsl' });

      assert.ok((mockMessenger.send as sinon.SinonStub).calledOnce);
      const msg = (mockMessenger.send as sinon.SinonStub).firstCall.args[0];
      assert.strictEqual(msg.type, 'error');
    });
  });

  suite('handleRequestWorkspaceFiles', () => {
    test('scans workspace and responds with file list', async () => {
      const WorkspaceFileScanner = require('../../../app/WorkspaceFileScanner');
      const mockFiles = [
        { name: 'texture.png', workspacePath: '@/texture.png', thumbnailUri: '/texture.png', isSameDirectory: true },
      ];
      const scanStub = sandbox.stub(WorkspaceFileScanner.WorkspaceFileScanner, 'scanFiles').resolves(mockFiles);

      await handler.handleRequestWorkspaceFiles(
        { extensions: ['png'], shaderPath: '/test/shader.glsl' },
        respondFn,
        (p: string) => p,
      );

      assert.ok(scanStub.calledOnce);
      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'workspaceFiles');
      assert.strictEqual(msg.payload.files.length, 1);
    });

    test('passes pathConverter through to scanner', async () => {
      const WorkspaceFileScanner = require('../../../app/WorkspaceFileScanner');
      let capturedConverter: ((p: string) => string) | undefined;
      sandbox.stub(WorkspaceFileScanner.WorkspaceFileScanner, 'scanFiles').callsFake(async (_ext: any, _path: any, converter: any) => {
        capturedConverter = converter;
        return [];
      });

      const customConverter = (p: string) => `http://example.com/${p}`;

      await handler.handleRequestWorkspaceFiles(
        { extensions: ['png'], shaderPath: '/test/shader.glsl' },
        respondFn,
        customConverter,
      );

      assert.ok(capturedConverter);
      assert.strictEqual(capturedConverter!('/img.png'), 'http://example.com//img.png');
    });

    test('responds with empty files array when scanner throws', async () => {
      const WorkspaceFileScanner = require('../../../app/WorkspaceFileScanner');
      sandbox.stub(WorkspaceFileScanner.WorkspaceFileScanner, 'scanFiles').rejects(new Error('scan error'));

      await handler.handleRequestWorkspaceFiles(
        { extensions: ['png'], shaderPath: '/test/shader.glsl' },
        respondFn,
        (p: string) => p,
      );

      assert.ok(respondFn.calledOnce);
      const msg = respondFn.firstCall.args[0];
      assert.strictEqual(msg.type, 'workspaceFiles');
      assert.deepStrictEqual(msg.payload.files, []);
    });
  });
});
