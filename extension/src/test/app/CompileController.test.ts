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
      getActiveOrLastViewedGLSLEditor: sandbox.stub().returns(null),
    };

    mockShaderProvider = {
      claimActiveAnalysisContext: sandbox.stub(),
      isLockedToDifferentShader: sandbox.stub().returns(false),
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
    sinon.assert.calledOnceWithExactly(
      mockShaderProvider.claimActiveAnalysisContext,
      '/mock/path/shader.glsl',
    );
    sinon.assert.callOrder(
      mockShaderProvider.claimActiveAnalysisContext,
      mockShaderProvider.sendShaderFromEditor,
    );
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

  test('handleActiveEditorChange does not recompile an unchanged shader when focus returns in hot mode', () => {
    const editor = createMockGLSLEditor();
    mockGlslFileTracker.isGlslEditor.returns(true);
    mockMessenger.hasActiveClients.returns(true);

    controller.handleActiveEditorChange(editor);
    mockShaderProvider.claimActiveAnalysisContext.resetHistory();
    mockShaderProvider.sendShaderFromEditor.resetHistory();
    controller.handleActiveEditorChange(editor);

    sinon.assert.notCalled(mockShaderProvider.claimActiveAnalysisContext);
    sinon.assert.notCalled(mockShaderProvider.sendShaderFromEditor);
  });

  test('handleActiveEditorChange compiles after a viewer connects if the earlier update was not sent', () => {
    const editor = createMockGLSLEditor();
    mockGlslFileTracker.isGlslEditor.returns(true);
    mockMessenger.hasActiveClients.returns(false);

    controller.handleActiveEditorChange(editor);
    sinon.assert.notCalled(mockShaderProvider.sendShaderFromEditor);

    mockMessenger.hasActiveClients.returns(true);
    controller.handleActiveEditorChange(editor);

    sinon.assert.calledOnce(mockShaderProvider.claimActiveAnalysisContext);
    sinon.assert.calledOnce(mockShaderProvider.sendShaderFromEditor);
  });

  test('handleActiveEditorChange does not recompile the locked project when a linked editor is activated', () => {
    const editor = createMockGLSLEditor('/mock/path/passes/compute.slang');
    mockGlslFileTracker.isGlslEditor.returns(true);
    mockMessenger.hasActiveClients.returns(true);
    mockShaderProvider.isLockedToDifferentShader.returns(true);

    controller.handleActiveEditorChange(editor);

    assert.ok(mockGlslFileTracker.setLastViewedGlslFile.calledWith('/mock/path/passes/compute.slang'));
    sinon.assert.notCalled(mockShaderProvider.claimActiveAnalysisContext);
    sinon.assert.notCalled(mockShaderProvider.sendShaderFromEditor);
  });

  test('handleTextDocumentSave recompiles visible GLSL document in save mode', () => {
    const editor = createMockGLSLEditor();
    const document = editor.document as vscode.TextDocument;
    mockGlslFileTracker.isGlslEditor.returns(true);
    mockMessenger.hasActiveClients.returns(true);
    controller.setMode('save');
    sandbox.stub(vscode.window, 'activeTextEditor').value(editor);

    controller.handleTextDocumentSave(document, [editor]);

    sinon.assert.calledOnceWithExactly(
      mockShaderProvider.claimActiveAnalysisContext,
      '/mock/path/shader.glsl',
    );
    assert.ok(mockShaderProvider.sendShaderFromEditor.calledOnceWith(editor));
  });

  test('Save All keeps visible non-active editor sends in the background', () => {
    const activeEditor = createMockGLSLEditor('/mock/path/active.glsl');
    const backgroundEditor = createMockGLSLEditor('/mock/path/background.glsl');
    mockGlslFileTracker.isGlslEditor.returns(true);
    mockMessenger.hasActiveClients.returns(true);
    controller.setMode('save');
    sandbox.stub(vscode.window, 'activeTextEditor').value(activeEditor);

    controller.handleTextDocumentSave(
      backgroundEditor.document,
      [activeEditor, backgroundEditor],
    );

    sinon.assert.notCalled(mockShaderProvider.claimActiveAnalysisContext);
    sinon.assert.notCalled(mockGlslFileTracker.setLastViewedGlslFile);
    sinon.assert.calledOnceWithExactly(
      mockShaderProvider.sendShaderFromEditor,
      backgroundEditor,
    );
  });

  test('Save All keeps non-visible shader path refreshes in the background', () => {
    const activeEditor = createMockGLSLEditor('/mock/path/active.glsl');
    const backgroundDocument = createMockGLSLEditor('/mock/path/background.glsl').document;
    mockMessenger.hasActiveClients.returns(true);
    controller.setMode('save');
    sandbox.stub(vscode.window, 'activeTextEditor').value(activeEditor);

    controller.handleTextDocumentSave(backgroundDocument, [activeEditor]);

    sinon.assert.notCalled(mockShaderProvider.claimActiveAnalysisContext);
    sinon.assert.notCalled(mockGlslFileTracker.setLastViewedGlslFile);
    sinon.assert.calledOnceWithExactly(
      mockShaderProvider.sendShaderFromPath,
      '/mock/path/background.glsl',
    );
  });

  test('manualCompileCurrentShader falls back to last viewed shader path', async () => {
    mockGlslFileTracker.getLastViewedGlslFile.returns('/mock/path/last-viewed.glsl');
    controller.setMode('manual');

    await controller.manualCompileCurrentShader(undefined);

    sinon.assert.calledOnceWithExactly(
      mockShaderProvider.claimActiveAnalysisContext,
      '/mock/path/last-viewed.glsl',
    );
    assert.ok(mockShaderProvider.sendShaderFromPath.calledOnceWith('/mock/path/last-viewed.glsl'));
  });

  test('manualCompileCurrentShader uses the last viewed GLSL editor when focus is elsewhere', async () => {
    const trackedEditor = createMockGLSLEditor('/mock/path/tracked.glsl');
    mockGlslFileTracker.getActiveOrLastViewedGLSLEditor.returns(trackedEditor);
    mockGlslFileTracker.isGlslEditor.withArgs(trackedEditor).returns(true);
    controller.setMode('manual');

    await controller.manualCompileCurrentShader(undefined);

    sinon.assert.calledOnceWithExactly(
      mockShaderProvider.claimActiveAnalysisContext,
      '/mock/path/tracked.glsl',
    );
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

  test('handleTextDocumentChange refreshes a background GLSL document without claiming it', () => {
    const document = {
      fileName: '/mock/path/shader.glsl',
      languageId: 'glsl',
      uri: vscode.Uri.file('/mock/path/shader.glsl'),
      getText: sandbox.stub().returns('// shader'),
    } as any;

    mockMessenger.hasActiveClients.returns(true);
    controller.setMode('hot');
    sandbox.stub(vscode.window, 'activeTextEditor').value(
      createMockGLSLEditor('/mock/path/active.glsl'),
    );

    controller.handleTextDocumentChange(
      { document } as vscode.TextDocumentChangeEvent,
    );

    sinon.assert.notCalled(mockGlslFileTracker.setLastViewedGlslFile);
    sinon.assert.notCalled(mockShaderProvider.claimActiveAnalysisContext);
    assert.ok(mockShaderProvider.sendShaderFromDocument.calledOnceWith(document));
  });
});
