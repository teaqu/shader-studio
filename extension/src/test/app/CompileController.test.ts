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
  let openTextDocuments: vscode.TextDocument[];

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
    openTextDocuments = [];
    sandbox.stub(vscode.workspace, 'textDocuments').get(() => openTextDocuments);

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
      getActiveOrLastViewedGLSLEditor: sandbox.stub().returns(null),
    };

    mockShaderProvider = {
      sendShaderFromEditor: sandbox.stub().resolves(),
      sendShaderFromDocument: sandbox.stub().resolves(),
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
    assert.ok(mockShaderProvider.sendShaderFromEditor.calledOnceWith(editor));
  });

  test('handleActiveEditorChange does not compile when returning to same shader in save mode', () => {
    const editor = createMockGLSLEditor();
    mockGlslFileTracker.isGlslEditor.returns(true);
    mockMessenger.hasActiveClients.returns(true);
    controller.setMode('save');

    controller.handleActiveEditorChange(editor);
    mockShaderProvider.sendShaderFromEditor.resetHistory();
    controller.handleActiveEditorChange(editor);

    sinon.assert.notCalled(mockShaderProvider.sendShaderFromEditor);
  });

  test('handleTextDocumentSave recompiles visible GLSL document in save mode', () => {
    const editor = createMockGLSLEditor();
    const document = editor.document as vscode.TextDocument;
    mockGlslFileTracker.isGlslEditor.returns(true);
    mockMessenger.hasActiveClients.returns(true);
    controller.setMode('save');

    controller.handleTextDocumentSave(document, [editor]);

    assert.ok(mockShaderProvider.sendShaderFromEditor.calledOnceWith(editor));
  });

  test('manualCompileCurrentShader falls back to last viewed shader path', async () => {
    mockGlslFileTracker.getLastViewedGlslFile.returns('/mock/path/last-viewed.glsl');
    controller.setMode('manual');

    await controller.manualCompileCurrentShader(undefined);

    assert.ok(mockShaderProvider.sendShaderFromPath.calledOnceWith('/mock/path/last-viewed.glsl'));
  });

  test('manualCompileCurrentShader uses the last viewed open GLSL document before reading from disk', async () => {
    const openDocument = {
      fileName: '/mock/path/last-viewed.glsl',
      languageId: 'glsl',
      uri: vscode.Uri.file('/mock/path/last-viewed.glsl'),
      getText: sandbox.stub().returns('// unsaved shader'),
    } as any;
    openTextDocuments = [openDocument];
    mockGlslFileTracker.getLastViewedGlslFile.returns('/mock/path/last-viewed.glsl');
    controller.setMode('manual');

    await controller.manualCompileCurrentShader(undefined);

    assert.ok(mockShaderProvider.sendShaderFromDocument.calledOnceWith(openDocument));
    sinon.assert.notCalled(mockShaderProvider.sendShaderFromPath);
  });

  test('manualCompileCurrentShader uses the last viewed GLSL editor when focus is elsewhere', async () => {
    const trackedEditor = createMockGLSLEditor('/mock/path/tracked.glsl');
    mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns(trackedEditor);
    mockGlslFileTracker.isGlslEditor.withArgs(trackedEditor).returns(true);
    controller.setMode('manual');

    await controller.manualCompileCurrentShader(undefined);

    assert.ok(mockShaderProvider.sendShaderFromEditor.calledOnceWith(trackedEditor));
  });

  test('manualCompileCurrentShader prefers the active GLSL editor over the last viewed editor', async () => {
    const activeEditor = createMockGLSLEditor('/mock/path/active.glsl');
    const trackedEditor = createMockGLSLEditor('/mock/path/tracked.glsl');
    mockGlslFileTracker.isGlslEditor.withArgs(activeEditor).returns(true);
    mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns(trackedEditor);
    controller.setMode('manual');

    await controller.manualCompileCurrentShader(activeEditor);

    assert.ok(mockShaderProvider.sendShaderFromEditor.calledOnceWith(activeEditor));
    assert.ok(mockShaderProvider.sendShaderFromEditor.neverCalledWith(trackedEditor));
  });

  test('manualCompileCurrentShader falls back to shader path when tracked editor is unavailable', async () => {
    mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns(null);
    mockGlslFileTracker.getLastViewedGlslFile.returns('/mock/path/fallback.glsl');
    controller.setMode('manual');

    await controller.manualCompileCurrentShader(undefined);

    assert.ok(mockShaderProvider.sendShaderFromPath.calledOnceWith('/mock/path/fallback.glsl'));
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
      { document: scriptDocument } as vscode.TextDocumentChangeEvent,
    );

    assert.ok(
      mockShaderProvider.sendShaderWithScriptContent.calledOnceWith(
        '/mock/path/shader.glsl',
        '// script contents',
      ),
    );
  });

  test('handleTextDocumentChange recompiles GLSL document in hot mode without relying on active editor focus', () => {
    const document = {
      fileName: '/mock/path/shader.glsl',
      languageId: 'glsl',
      uri: vscode.Uri.file('/mock/path/shader.glsl'),
      getText: sandbox.stub().returns('// shader'),
    } as any;

    mockMessenger.hasActiveClients.returns(true);
    controller.setMode('hot');

    controller.handleTextDocumentChange(
      { document } as vscode.TextDocumentChangeEvent,
    );

    assert.ok(mockGlslFileTracker.setLastViewedGlslFile.calledWith('/mock/path/shader.glsl'));
    assert.ok(mockShaderProvider.sendShaderFromDocument.calledOnceWith(document));
  });
});
