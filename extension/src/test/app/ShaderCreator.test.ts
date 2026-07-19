import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ShaderCreator } from '../../app/ShaderCreator';

suite('ShaderCreator Test Suite', () => {
  let testDir: string;
  let mockLogger: any;
  let mockGlslFileTracker: any;
  let shaderCreator: ShaderCreator;
  let sandbox: sinon.SinonSandbox;
  let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

  suiteSetup(() => {
    testDir = path.join(os.tmpdir(), `shader-creator-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    originalWorkspaceFolders = vscode.workspace.workspaceFolders;
  });

  setup(() => {
    sandbox = sinon.createSandbox();

    mockLogger = {
      info: sandbox.spy(),
      error: sandbox.spy(),
      debug: sandbox.spy(),
      warn: sandbox.spy(),
    };

    mockGlslFileTracker = {
      getLastViewedGlslFile: sandbox.stub().returns(null),
    };

    shaderCreator = new ShaderCreator(mockLogger, mockGlslFileTracker);
  });

  teardown(() => {
    sandbox.restore();
  });

  suiteTeardown(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(testDir, file)); 
        } catch { }
      }
      try {
        fs.rmdirSync(testDir); 
      } catch { }
    }

    // Restore workspaceFolders
    try {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value(originalWorkspaceFolders);
    } catch { }
  });

  test('should be instantiable with Logger and GlslFileTracker', () => {
    assert.strictEqual(shaderCreator instanceof ShaderCreator, true);
  });

  test('should create a shader file when user picks a location', async () => {
    const filePath = path.join(testDir, 'myshader.glsl');
    const fileUri = vscode.Uri.file(filePath);

    sandbox.stub(vscode.window, 'showSaveDialog').resolves(fileUri);
    sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
    const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

    await shaderCreator.create();

    assert.strictEqual(fs.existsSync(filePath), true);
    assert.ok((mockLogger.info as sinon.SinonSpy).calledOnce);
    assert.ok(infoStub.calledOnce);

    // Clean up
    try {
      fs.unlinkSync(filePath); 
    } catch { }
  });

  test('should do nothing when user cancels the save dialog', async () => {
    sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

    await shaderCreator.create();

    assert.ok((mockLogger.info as sinon.SinonSpy).notCalled);
  });

  test('should default to last viewed file directory', async () => {
    const lastViewedDir = path.join(testDir, 'shaders');
    if (!fs.existsSync(lastViewedDir)) {
      fs.mkdirSync(lastViewedDir, { recursive: true });
    }
    mockGlslFileTracker.getLastViewedGlslFile.returns(
      path.join(lastViewedDir, 'existing.glsl')
    );

    const showSaveDialogStub = sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

    await shaderCreator.create();

    const callArgs = showSaveDialogStub.firstCall.args[0]!;
    const defaultUri = callArgs.defaultUri!;
    assert.strictEqual(path.dirname(defaultUri.fsPath), lastViewedDir);

    // Clean up
    try {
      fs.rmdirSync(lastViewedDir); 
    } catch { }
  });

  test('should fall back to workspace root when no last viewed file', async () => {
    const testUri = vscode.Uri.file(testDir);
    const mockWorkspaceFolder: vscode.WorkspaceFolder = {
      uri: testUri,
      name: 'test-workspace',
      index: 0,
    } as any;

    sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
    mockGlslFileTracker.getLastViewedGlslFile.returns(null);

    const showSaveDialogStub = sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

    await shaderCreator.create();

    const callArgs = showSaveDialogStub.firstCall.args[0]!;
    const defaultUri = callArgs.defaultUri!;
    assert.strictEqual(path.dirname(defaultUri.fsPath), testDir);
  });

  test('should pass GLSL filter and title to save dialog', async () => {
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
      uri: vscode.Uri.file(testDir), name: 'test', index: 0,
    }]);
    const showSaveDialogStub = sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

    await shaderCreator.create();

    const callArgs = showSaveDialogStub.firstCall.args[0]!;
    assert.deepStrictEqual(callArgs.filters, {
      'GLSL Shader': ['glsl'],
      'Slang Shader': ['slang'],
    });
    assert.strictEqual(callArgs.title, 'New Shader');
  });

  test('should use shadertoy.glsl as default filename', async () => {
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
      uri: vscode.Uri.file(testDir), name: 'test', index: 0,
    }]);
    const showSaveDialogStub = sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

    await shaderCreator.create();

    const callArgs = showSaveDialogStub.firstCall.args[0]!;
    assert.strictEqual(path.basename(callArgs.defaultUri!.fsPath), 'shadertoy.glsl');
  });

  test('should open the file in editor after creation', async () => {
    const filePath = path.join(testDir, 'open-test.glsl');
    const fileUri = vscode.Uri.file(filePath);

    sandbox.stub(vscode.window, 'showSaveDialog').resolves(fileUri);
    const openDocStub = sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
    const showDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showInformationMessage');

    await shaderCreator.create();

    assert.ok(openDocStub.calledOnce);
    assert.strictEqual((openDocStub.firstCall.args[0] as vscode.Uri).fsPath, fileUri.fsPath);
    assert.ok(showDocStub.calledOnce);
    assert.deepStrictEqual(showDocStub.firstCall.args[1], { preview: false });

    // Clean up
    try {
      fs.unlinkSync(filePath); 
    } catch { }
  });

  test('should write shader template content to the file', async () => {
    const filePath = path.join(testDir, 'template-test.glsl');
    const fileUri = vscode.Uri.file(filePath);

    sandbox.stub(vscode.window, 'showSaveDialog').resolves(fileUri);
    sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showInformationMessage');

    await shaderCreator.create();

    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('void mainImage'));
    assert.ok(content.includes('fragColor'));

    // Clean up
    try {
      fs.unlinkSync(filePath); 
    } catch { }
  });

  test('keeps the existing GLSL template byte-for-byte unchanged', async () => {
    const filePath = path.join(testDir, 'legacy.glsl');
    sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(filePath));
    sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showInformationMessage');

    await shaderCreator.create();

    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord/iResolution.xy;

    // Time varying pixel color
    vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));

    // Output to screen
    fragColor = vec4(col,1.0);
}`);
  });

  test('writes a modern Slang template with a sanitized module name', async () => {
    const filePath = path.join(testDir, '2 cool-shader.slang');
    sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(filePath));
    sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showInformationMessage');

    await shaderCreator.create();

    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.startsWith('#language slang 2026\nmodule _2_cool_shader;\n'));
    assert.ok(content.includes('float4 mainImage(float2 fragCoord)'));
  });

  test('prefixes Slang reserved words when deriving module names', async () => {
    const modulePath = path.join(testDir, 'module.slang');
    const floatPath = path.join(testDir, 'float.slang');
    sandbox.stub(vscode.window, 'showSaveDialog')
      .onFirstCall().resolves(vscode.Uri.file(modulePath))
      .onSecondCall().resolves(vscode.Uri.file(floatPath));
    sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showInformationMessage');

    await shaderCreator.create();
    await shaderCreator.create();

    assert.ok(fs.readFileSync(modulePath, 'utf8').startsWith('#language slang 2026\nmodule _module;'));
    assert.ok(fs.readFileSync(floatPath, 'utf8').startsWith('#language slang 2026\nmodule _float;'));
  });

  test('prefixes less-common Slang declaration keywords in module names', async () => {
    const filePath = path.join(testDir, 'each.slang');
    sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(filePath));
    sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showInformationMessage');

    await shaderCreator.create();

    assert.ok(fs.readFileSync(filePath, 'utf8').startsWith('#language slang 2026\nmodule _each;'));
  });

});
