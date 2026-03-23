import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { CompileController } from '../../app/CompileController';

suite('CompileController Test Suite', () => {
  let sandbox: sinon.SinonSandbox;
  let mockContext: vscode.ExtensionContext;
  let mockGlslFileTracker: any;
  let mockShaderProvider: any;
  let mockMessenger: any;
  let controller: CompileController;

  function createMockGLSLEditor(filePath: string = '/mock/path/shader.glsl'): vscode.TextEditor {
    return {
      document: {
        fileName: filePath,
        languageId: 'glsl',
        uri: vscode.Uri.file(filePath),
        getText: sandbox.stub().returns('// shader'),
      },
    } as any;
  }

  function createMockScriptDocument(filePath: string): vscode.TextDocument {
    return {
      fileName: filePath,
      uri: vscode.Uri.file(filePath),
      getText: sandbox.stub().returns('// script contents'),
    } as any;
  }

  setup(() => {
    sandbox = sinon.createSandbox();

    mockContext = {
      globalState: {
        get: sandbox.stub().callsFake((_key: string, defaultValue?: any) => defaultValue),
        update: sandbox.stub().resolves(),
      },
    } as any;

    mockGlslFileTracker = {
      isGlslEditor: sandbox.stub().returns(false),
      setLastViewedGlslFile: sandbox.stub(),
      getLastViewedGlslFile: sandbox.stub().returns(null),
    };

    mockShaderProvider = {
      sendShaderToWebview: sandbox.stub().resolves(),
      sendShaderFromPath: sandbox.stub().resolves(),
      sendShaderWithScriptContent: sandbox.stub().resolves(),
      getActiveConfig: sandbox.stub().returns(null),
      getScriptPath: sandbox.stub().returns(null),
    };

    mockMessenger = {
      hasActiveClients: sandbox.stub().returns(false),
      send: sandbox.stub(),
    };

    controller = new CompileController(
      mockContext,
      mockGlslFileTracker,
      mockShaderProvider,
      mockMessenger,
    );
  });

  teardown(() => {
    sandbox.restore();
  });

  test('defaults to hot mode', () => {
    assert.strictEqual(controller.getMode(), 'hot');
  });

  test('setMode updates mode and persists it', () => {
    controller.setMode('manual');

    assert.strictEqual(controller.getMode(), 'manual');
    assert.ok((mockContext.globalState.update as sinon.SinonStub).calledWith('shader-studio.compileMode', 'manual'));
  });

  test('handleActiveEditorChange compiles on first GLSL selection in manual mode when clients exist', () => {
    const editor = createMockGLSLEditor();
    mockGlslFileTracker.isGlslEditor.returns(true);
    mockMessenger.hasActiveClients.returns(true);
    controller.setMode('manual');

    controller.handleActiveEditorChange(editor);

    assert.ok(mockGlslFileTracker.setLastViewedGlslFile.calledWith('/mock/path/shader.glsl'));
    assert.ok(mockShaderProvider.sendShaderToWebview.calledOnceWith(editor));
  });

  test('handleActiveEditorChange does not compile when returning to same shader in save mode', () => {
    const editor = createMockGLSLEditor();
    mockGlslFileTracker.isGlslEditor.returns(true);
    mockMessenger.hasActiveClients.returns(true);
    controller.setMode('save');

    controller.handleActiveEditorChange(editor);
    mockShaderProvider.sendShaderToWebview.resetHistory();
    controller.handleActiveEditorChange(editor);

    sinon.assert.notCalled(mockShaderProvider.sendShaderToWebview);
  });

  test('handleTextDocumentSave recompiles visible GLSL document in save mode', () => {
    const editor = createMockGLSLEditor();
    const document = editor.document as vscode.TextDocument;
    mockGlslFileTracker.isGlslEditor.returns(true);
    mockMessenger.hasActiveClients.returns(true);
    controller.setMode('save');

    controller.handleTextDocumentSave(document, [editor]);

    assert.ok(mockShaderProvider.sendShaderToWebview.calledOnceWith(editor));
  });

  test('manualCompileCurrentShader falls back to last viewed shader path', async () => {
    mockGlslFileTracker.getLastViewedGlslFile.returns('/mock/path/last-viewed.glsl');
    controller.setMode('manual');

    await controller.manualCompileCurrentShader(undefined);

    assert.ok(mockShaderProvider.sendShaderFromPath.calledOnceWith('/mock/path/last-viewed.glsl'));
  });

  test('manualCompileCurrentShader sends error when no shader is available', async () => {
    controller.setMode('manual');

    await controller.manualCompileCurrentShader(undefined);

    assert.ok(mockMessenger.send.calledOnce);
    assert.deepStrictEqual(mockMessenger.send.firstCall.args[0], {
      type: 'error',
      payload: ['No GLSL file to compile. Open a .glsl file first.'],
    });
  });

  test('handleTextDocumentChange recompiles linked script changes in hot mode', () => {
    const activeEditor = {
      document: {
        fileName: '/mock/path/not-glsl.txt',
        languageId: 'plaintext',
        uri: vscode.Uri.file('/mock/path/not-glsl.txt'),
      },
    } as any;
    const scriptDocument = createMockScriptDocument('/mock/path/script.ts');

    mockGlslFileTracker.isGlslEditor.returns(false);
    mockGlslFileTracker.getLastViewedGlslFile.returns('/mock/path/shader.glsl');
    mockShaderProvider.getActiveConfig.returns({ script: './script.ts' });
    mockShaderProvider.getScriptPath.returns('/mock/path/script.ts');
    controller.setMode('hot');

    controller.handleTextDocumentChange(
      activeEditor,
      { document: scriptDocument } as vscode.TextDocumentChangeEvent,
    );

    assert.ok(
      mockShaderProvider.sendShaderWithScriptContent.calledOnceWith(
        '/mock/path/shader.glsl',
        '// script contents',
      ),
    );
  });
});
