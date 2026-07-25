import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { __testOnly, ShaderCreator } from '../../app/ShaderCreator';

const EXISTING_GLSL_TEMPLATE = `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord/iResolution.xy;

    // Time varying pixel color
    vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));

    // Output to screen
    fragColor = vec4(col,1.0);
}`;

const SLANG_GRAMMAR_KEYWORDS_AND_MODIFIERS = [
  'if', 'else', 'switch', 'case', 'default', 'for', 'while', 'do', 'break', 'continue', 'return', 'discard',
  'module', 'import', 'implementing', 'interface', 'extension', 'struct', 'class', 'enum', 'typedef', 'typealias',
  'associatedtype', 'property', 'namespace', 'using', 'generic', 'where', 'each', 'expand', 'let', 'var', 'func',
  'this', 'This', 'operator', 'public', 'private', 'internal', 'static', 'const', 'uniform', 'in', 'out', 'inout',
  'ref', 'groupshared', 'precise', 'nointerpolation', 'linear', 'centroid', 'sample', 'globallycoherent', 'volatile',
  'extern', 'inline', 'mutating', 'nonmutating', 'differentiable', 'no_diff',
];

const SLANG_COMPILER_RESERVED_WORDS = [
  '__builtin', '__generic', '__include', '__intrinsic_op', '__target_intrinsic', 'asm', 'catch', 'cbuffer',
  'defer', 'export', 'foreach', 'from', 'get', 'new', 'nullptr', 'override', 'protected', 'set', 'shared',
  'sizeof', 'throw', 'try', 'union',
];

const SLANG_CONCRETE_BUILTIN_TYPES = [
  'void', 'bool', 'half', 'float', 'double', 'float16_t', 'float32_t', 'float64_t', 'int', 'uint', 'int8_t',
  'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t', 'int64_t', 'uint64_t', 'vector', 'matrix',
  'bool2', 'bool3', 'bool4', 'half2', 'half3', 'half4', 'float2', 'float3', 'float4', 'double2', 'double3',
  'double4', 'int2', 'int3', 'int4', 'uint2', 'uint3', 'uint4', 'Texture1D', 'Texture1DArray', 'Texture2D',
  'Texture2DArray', 'Texture3D', 'Texture3DArray', 'TextureCube', 'TextureCubeArray', 'SamplerState',
  'SamplerComparisonState', 'RWTexture1D', 'RWTexture1DArray', 'RWTexture2D', 'RWTexture2DArray', 'RWTexture3D',
  'RWTexture3DArray', 'Buffer', 'RWBuffer', 'StructuredBuffer', 'RWStructuredBuffer', 'ByteAddressBuffer', 'RWByteAddressBuffer',
  'ParameterBlock', 'ConstantBuffer', 'RaytracingAccelerationStructure',
];

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
    assert.strictEqual(content, EXISTING_GLSL_TEMPLATE);

    // Clean up
    try {
      fs.unlinkSync(filePath); 
    } catch { }
  });

  test('writes a Slang 2026 template with a sanitized module name', async () => {
    const filePath = path.join(testDir, '2 cool-shader.slang');
    const fileUri = vscode.Uri.file(filePath);
    sandbox.stub(vscode.window, 'showSaveDialog').resolves(fileUri);
    sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showInformationMessage');

    await shaderCreator.create();

    assert.strictEqual(
      fs.readFileSync(filePath, 'utf8'),
      `#language slang 2026
module _2_cool_shader;

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    return float4(uv, 0.0, 1.0);
}`,
    );
    fs.unlinkSync(filePath);
  });

  test('uses shader when sanitizing an empty Slang module name', () => {
    assert.strictEqual(__testOnly.sanitizeSlangModuleName(''), 'shader');
  });

  test('prefixes every Slang grammar keyword and modifier', () => {
    for (const name of SLANG_GRAMMAR_KEYWORDS_AND_MODIFIERS) {
      assert.strictEqual(__testOnly.sanitizeSlangModuleName(name), `_${name}`, name);
    }
  });

  test('prefixes compiler-reserved Slang words', () => {
    for (const name of SLANG_COMPILER_RESERVED_WORDS) {
      assert.strictEqual(__testOnly.sanitizeSlangModuleName(name), `_${name}`, name);
    }
  });

  test('prefixes Slang language constants', () => {
    for (const name of ['true', 'false', 'null', 'none']) {
      assert.strictEqual(__testOnly.sanitizeSlangModuleName(name), `_${name}`, name);
    }
  });

  test('prefixes every concrete Slang built-in type and matrix spelling', () => {
    for (const name of SLANG_CONCRETE_BUILTIN_TYPES) {
      assert.strictEqual(__testOnly.sanitizeSlangModuleName(name), `_${name}`, name);
    }
    for (const scalar of ['bool', 'half', 'float', 'double', 'float16_t', 'float32_t', 'float64_t', 'int', 'uint', 'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t', 'int64_t', 'uint64_t']) {
      for (const rows of [2, 3, 4]) {
        for (const columns of [2, 3, 4]) {
          const name = `${scalar}${rows}x${columns}`;
          assert.strictEqual(__testOnly.sanitizeSlangModuleName(name), `_${name}`, name);
        }
      }
    }
  });

  for (const [filename, moduleName] of [
    ['module.slang', '_module'],
    ['each.slang', '_each'],
    ['float.slang', '_float'],
    ['Texture2D.slang', '_Texture2D'],
    ['float4.slang', '_float4'],
    ['in-out.slang', 'in_out'],
    ['a.b.slang', 'a_b'],
    ['my shader!.SLANG', 'my_shader_'],
    ['Module.slang', 'Module'],
    ['texture2d.slang', 'texture2d'],
  ]) {
    test(`uses a valid Slang module identifier for ${filename}`, async () => {
      const filePath = path.join(testDir, filename);
      const fileUri = vscode.Uri.file(filePath);
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(fileUri);
      sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
      sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
      sandbox.stub(vscode.window, 'showInformationMessage');

      await shaderCreator.create();

      assert.ok(fs.readFileSync(filePath, 'utf8').includes(`module ${moduleName};`));
      fs.unlinkSync(filePath);
    });
  }

  test('keeps the existing GLSL template byte-for-byte unchanged for non-Slang extensions', async () => {
    const filePath = path.join(testDir, 'legacy.GLSL');
    const fileUri = vscode.Uri.file(filePath);
    sandbox.stub(vscode.window, 'showSaveDialog').resolves(fileUri);
    sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
    sandbox.stub(vscode.window, 'showInformationMessage');

    await shaderCreator.create();

    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), EXISTING_GLSL_TEMPLATE);
    fs.unlinkSync(filePath);
  });

});
