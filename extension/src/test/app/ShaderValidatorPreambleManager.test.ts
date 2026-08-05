import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import {
  SHADER_VALIDATOR_EXTENSION_ID,
  SHADER_VALIDATOR_PREAMBLE_SETTING,
  SHADER_VALIDATOR_SPIRV_VERSION_SETTING,
  SHADER_VALIDATOR_TARGET_CLIENT_SETTING,
  ShaderValidatorPreambleManager,
} from '../../app/ShaderValidatorPreambleManager';
import type { ShaderValidatorPreambleSnapshot } from '../../app/ShaderValidatorPreamble';

suite('Shader Validator preamble manager', () => {
  const workspacePath = '/workspace';
  const shaderPath = `${workspacePath}/image.glsl`;
  const destination = `${workspacePath}/.vscode/shader-studio-preamble.glsl`;
  const tempPath = `${destination}.tmp-${process.pid}`;
  const managedSetting = destination;
  const legacyManagedSetting = '${workspaceFolder}/.vscode/shader-studio-preamble.glsl';
  const snapshot: ShaderValidatorPreambleSnapshot = {
    shaderPath,
    configPath: `${workspacePath}/image.sha.json`,
    passName: 'Image',
  };

  let sandbox: sinon.SinonSandbox;
  let folder: vscode.WorkspaceFolder;
  let context: vscode.ExtensionContext;
  let configuration: {
    get: sinon.SinonStub;
    has: sinon.SinonStub;
    inspect: sinon.SinonStub;
    update: sinon.SinonStub;
  };
  let fs: {
    existsSync: sinon.SinonStub;
    readFileSync: sinon.SinonStub;
    mkdirSync: sinon.SinonStub;
    writeFileSync: sinon.SinonStub;
    renameSync: sinon.SinonStub;
    unlinkSync: sinon.SinonStub;
  };
  let logger: {
    warn: sinon.SinonStub;
    error: sinon.SinonStub;
  };
  let getExtension: sinon.SinonStub;
  let getWorkspaceFolders: sinon.SinonStub;
  let showInformationMessage: sinon.SinonStub;
  let extensionListener: (() => void) | undefined;
  let listenerDisposable: { dispose: sinon.SinonStub };

  const installedExtension = { id: 'antaalt.shader-validator' } as unknown as vscode.Extension<unknown>;

  function createManager(): ShaderValidatorPreambleManager {
    return new ShaderValidatorPreambleManager(context, logger, {
      fs,
      getExtension,
      getWorkspaceFolders,
      onDidChangeExtensions: (listener: () => void) => {
        extensionListener = listener;
        return listenerDisposable;
      },
      showInformationMessage,
    });
  }

  function inspectWith(values: {
    defaultValue?: string;
    globalValue?: string;
    workspaceValue?: string;
    workspaceFolderValue?: string;
  } = {}) {
    return {
      key: 'shader-validator.glsl.preamble',
      ...values,
    };
  }

  async function flushPromises(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  setup(() => {
    sandbox = sinon.createSandbox();
    folder = {
      uri: vscode.Uri.file(workspacePath),
      name: 'workspace',
      index: 0,
    };
    context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    configuration = {
      get: sandbox.stub().returns(undefined),
      has: sandbox.stub().returns(false),
      inspect: sandbox.stub().returns(inspectWith()),
      update: sandbox.stub().resolves(),
    };
    fs = {
      existsSync: sandbox.stub().returns(false),
      readFileSync: sandbox.stub(),
      mkdirSync: sandbox.stub(),
      writeFileSync: sandbox.stub(),
      renameSync: sandbox.stub(),
      unlinkSync: sandbox.stub(),
    };
    logger = {
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
    getExtension = sandbox.stub().returns(installedExtension);
    getWorkspaceFolders = sandbox.stub().returns([folder]);
    showInformationMessage = sandbox.stub().resolves(undefined);
    listenerDisposable = { dispose: sandbox.stub() };

    sandbox.stub(vscode.workspace, 'getWorkspaceFolder').returns(folder);
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(
      configuration as unknown as vscode.WorkspaceConfiguration,
    );
  });

  teardown(() => {
    sandbox.restore();
  });

  test('atomically writes the generated file and configures an installed companion extension', async () => {
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledWith(fs.mkdirSync, '/workspace/.vscode', { recursive: true });
    sinon.assert.calledOnce(fs.writeFileSync);
    sinon.assert.calledWith(fs.writeFileSync, tempPath, sinon.match.string, 'utf8');
    sinon.assert.calledOnce(fs.renameSync);
    sinon.assert.calledWith(fs.renameSync, tempPath, destination);
    assert.strictEqual(configuration.update.firstCall.args[1], managedSetting);
    assert.strictEqual(
      configuration.update.firstCall.args[2],
      vscode.ConfigurationTarget.Workspace,
    );
  });

  test('sets Shader Validator to its OpenGL target when the user has not configured one', async () => {
    configuration.get.withArgs(SHADER_VALIDATOR_TARGET_CLIENT_SETTING).returns('Vulkan1_3');
    configuration.inspect.withArgs(SHADER_VALIDATOR_TARGET_CLIENT_SETTING).returns(
      inspectWith({ defaultValue: 'Vulkan1_3' }),
    );
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledWithExactly(
      configuration.update,
      SHADER_VALIDATOR_TARGET_CLIENT_SETTING,
      'OpenGL450',
      vscode.ConfigurationTarget.Workspace,
    );
  });

  test('disables SPIR-V when configuring Shader Validator for WebGL-style uniforms', async () => {
    configuration.inspect.withArgs(SHADER_VALIDATOR_TARGET_CLIENT_SETTING).returns(
      inspectWith({ defaultValue: 'Vulkan1_3' }),
    );
    configuration.inspect.withArgs(SHADER_VALIDATOR_SPIRV_VERSION_SETTING).returns(
      inspectWith({ defaultValue: 'SPIRV1_6' }),
    );
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledWithExactly(
      configuration.update,
      SHADER_VALIDATOR_SPIRV_VERSION_SETTING,
      'None',
      vscode.ConfigurationTarget.Workspace,
    );
  });

  test('preserves a user-configured Shader Validator target client', async () => {
    configuration.inspect.withArgs(SHADER_VALIDATOR_TARGET_CLIENT_SETTING).returns(
      inspectWith({ workspaceValue: 'Vulkan1_3' }),
    );
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.neverCalledWith(
      configuration.update,
      SHADER_VALIDATOR_TARGET_CLIENT_SETTING,
      sinon.match.any,
      sinon.match.any,
    );
  });

  test('installs a baseline preamble for each workspace on activation', async () => {
    const manager = createManager();

    await manager.initializeWorkspaceFolders();

    sinon.assert.calledOnceWithExactly(fs.writeFileSync, tempPath, sinon.match(
      (content: unknown) => typeof content === 'string'
        && content.includes('uniform vec3 iResolution;')
        && content.includes('uniform float iTime;'),
    ), 'utf8');
    sinon.assert.calledWithExactly(
      configuration.update,
      SHADER_VALIDATOR_PREAMBLE_SETTING,
      managedSetting,
      vscode.ConfigurationTarget.Workspace,
    );
  });

  test('writes the generated file without coordinating settings when the companion extension is absent', async () => {
    getExtension.returns(undefined);
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledOnce(fs.writeFileSync);
    sinon.assert.notCalled(vscode.workspace.getConfiguration as sinon.SinonStub);
    sinon.assert.notCalled(configuration.get);
    sinon.assert.notCalled(configuration.inspect);
    sinon.assert.notCalled(configuration.update);
    sinon.assert.notCalled(showInformationMessage);
  });

  test('updates the workspace setting only when every user scope is empty', async () => {
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledWith(getExtension, SHADER_VALIDATOR_EXTENSION_ID);
    assert.strictEqual(getExtension.firstCall.args[0], 'antaalt.shader-validator');
    sinon.assert.calledWith(
      configuration.update,
      SHADER_VALIDATOR_PREAMBLE_SETTING,
      managedSetting,
      vscode.ConfigurationTarget.Workspace,
    );
  });

  for (const [scope, values] of [
    ['global', { globalValue: '/global/user-preamble.glsl' }],
    ['workspace', { workspaceValue: '/workspace/user-preamble.glsl' }],
    ['workspace-folder', { workspaceFolderValue: '/folder/user-preamble.glsl' }],
  ] as const) {
    test(`never changes a non-empty ${scope} preamble setting`, async () => {
      configuration.inspect.returns(inspectWith(values));
      const manager = createManager();

      await manager.apply({ kind: 'valid', snapshot });

      sinon.assert.notCalled(configuration.update);
      sinon.assert.calledOnce(showInformationMessage);
    });
  }

  test('ignores default and empty inspected values when deciding whether a user setting exists', async () => {
    configuration.inspect.returns(inspectWith({
      defaultValue: '/extension/default.glsl',
      globalValue: '',
      workspaceValue: '   ',
      workspaceFolderValue: undefined,
    }));
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledWith(
      configuration.update,
      SHADER_VALIDATOR_PREAMBLE_SETTING,
      managedSetting,
      vscode.ConfigurationTarget.Workspace,
    );
    sinon.assert.notCalled(showInformationMessage);
  });

  test('recognizes the effective managed setting across reloads despite a lower-precedence conflict', async () => {
    configuration.get.withArgs('glsl.preamble').returns(managedSetting);
    configuration.inspect.returns(inspectWith({
      globalValue: '/global/user-preamble.glsl',
      workspaceFolderValue: managedSetting,
    }));
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.notCalled(configuration.update);
    sinon.assert.notCalled(showInformationMessage);
  });

  test('migrates the legacy workspace-variable setting to the generated absolute path', async () => {
    configuration.get.withArgs('glsl.preamble').returns(legacyManagedSetting);
    configuration.inspect.returns(inspectWith({ workspaceFolderValue: legacyManagedSetting }));
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledOnceWithExactly(
      configuration.update,
      SHADER_VALIDATOR_PREAMBLE_SETTING,
      managedSetting,
      vscode.ConfigurationTarget.Workspace,
    );
    sinon.assert.notCalled(showInformationMessage);
  });

  test('shows the existing-setting message once per workspace during a manager lifetime', async () => {
    configuration.inspect.returns(inspectWith({ workspaceValue: '/workspace/user-preamble.glsl' }));
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });
    await manager.apply({ kind: 'valid', snapshot: { ...snapshot, passName: 'Buffer A' } });

    sinon.assert.calledOnce(showInformationMessage);
    sinon.assert.notCalled(configuration.update);
  });

  test('explains how to manually select the generated preamble after a setting conflict', async () => {
    configuration.inspect.returns(inspectWith({ workspaceValue: '/workspace/user-preamble.glsl' }));
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledOnceWithExactly(
      showInformationMessage,
      'Shader Validator already has a GLSL preamble configured for workspace; '
        + 'Shader Studio left it unchanged. To use Shader Studio\'s generated preamble, '
        + 'manually set shader-validator.glsl.preamble to '
        + '/workspace/.vscode/shader-studio-preamble.glsl.',
    );
  });

  test('tracks existing-setting notifications independently for each workspace', async () => {
    const secondFolder = {
      uri: vscode.Uri.file('/second'),
      name: 'second',
      index: 1,
    };
    const getWorkspaceFolder = vscode.workspace.getWorkspaceFolder as sinon.SinonStub;
    getWorkspaceFolder.callsFake((uri: vscode.Uri) => uri.fsPath.startsWith('/second') ? secondFolder : folder);
    configuration.inspect.returns(inspectWith({ workspaceValue: '/workspace/user-preamble.glsl' }));
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });
    await manager.apply({
      kind: 'valid',
      snapshot: { ...snapshot, shaderPath: '/second/image.glsl' },
    });
    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledTwice(showInformationMessage);
    sinon.assert.notCalled(configuration.update);
  });

  test('skips the atomic replacement when existing content is identical', async () => {
    const manager = createManager();
    await manager.apply({ kind: 'valid', snapshot });
    const generatedContent = fs.writeFileSync.firstCall.args[1] as string;
    fs.existsSync.withArgs(destination).returns(true);
    fs.readFileSync.withArgs(destination, 'utf8').returns(generatedContent);
    fs.mkdirSync.resetHistory();
    fs.writeFileSync.resetHistory();
    fs.renameSync.resetHistory();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.notCalled(fs.mkdirSync);
    sinon.assert.notCalled(fs.writeFileSync);
    sinon.assert.notCalled(fs.renameSync);
  });

  test('writes changed content to the known sibling temp file before renaming it', async () => {
    fs.existsSync.withArgs(destination).returns(true);
    fs.readFileSync.withArgs(destination, 'utf8').returns('old preamble');
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.callOrder(fs.writeFileSync, fs.renameSync);
    sinon.assert.calledWith(fs.writeFileSync, tempPath, sinon.match.string, 'utf8');
    sinon.assert.calledWith(fs.renameSync, tempPath, destination);
  });

  for (const operation of ['read', 'mkdir'] as const) {
    test(`${operation} failure logs without rejecting or replacing the destination`, async () => {
      if (operation === 'read') {
        fs.existsSync.withArgs(destination).returns(true);
        fs.readFileSync.throws(new Error('read failed'));
      } else {
        fs.mkdirSync.throws(new Error('mkdir failed'));
      }
      const manager = createManager();

      await manager.apply({ kind: 'valid', snapshot });

      sinon.assert.calledOnce(logger.error);
      sinon.assert.notCalled(fs.writeFileSync);
      sinon.assert.notCalled(fs.renameSync);
      sinon.assert.notCalled(fs.unlinkSync);
    });
  }

  test('destination existence probe failure logs, cleans only the known temp file, and does not replace', async () => {
    fs.existsSync.withArgs(destination).throws(new Error('destination probe failed'));
    fs.existsSync.withArgs(tempPath).returns(true);
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledOnce(logger.error);
    sinon.assert.calledWith(fs.existsSync, destination);
    sinon.assert.calledWith(fs.existsSync, tempPath);
    sinon.assert.calledOnceWithExactly(fs.unlinkSync, tempPath);
    sinon.assert.notCalled(fs.mkdirSync);
    sinon.assert.notCalled(fs.writeFileSync);
    sinon.assert.notCalled(fs.renameSync);
  });

  for (const operation of ['write', 'rename'] as const) {
    test(`${operation} failure logs, cleans only the known temp file when present, and does not reject`, async () => {
      fs.existsSync.withArgs(tempPath).returns(true);
      const failingStub = operation === 'write' ? fs.writeFileSync : fs.renameSync;
      failingStub.throws(new Error(`${operation} failed`));
      const manager = createManager();

      await manager.apply({ kind: 'valid', snapshot });

      sinon.assert.calledOnce(logger.error);
      sinon.assert.calledOnce(fs.unlinkSync);
      sinon.assert.calledWithExactly(fs.unlinkSync, tempPath);
    });
  }

  test('does not unlink anything when a failed write left no known temp file', async () => {
    fs.writeFileSync.throws(new Error('write failed'));
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledOnce(logger.error);
    sinon.assert.notCalled(fs.unlinkSync);
  });

  test('cleanup existence probe failure logs without deleting or replacing any file', async () => {
    fs.writeFileSync.throws(new Error('write failed'));
    fs.existsSync.withArgs(tempPath).throws(new Error('cleanup probe failed'));
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledTwice(logger.error);
    sinon.assert.calledWith(fs.existsSync, tempPath);
    sinon.assert.notCalled(fs.unlinkSync);
    sinon.assert.notCalled(fs.renameSync);
  });

  test('logs cleanup failure without rejecting file application', async () => {
    fs.writeFileSync.throws(new Error('write failed'));
    fs.existsSync.withArgs(tempPath).returns(true);
    fs.unlinkSync.throws(new Error('cleanup failed'));
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledTwice(logger.error);
  });

  test('forwards every builder warning to the logger', async () => {
    const manager = createManager();

    await manager.apply({
      kind: 'valid',
      snapshot: {
        ...snapshot,
        customUniformDeclarations: 'uniform mat4 unsupported;\nuniform float iTime;',
      },
    });

    sinon.assert.calledTwice(logger.warn);
    assert.match(logger.warn.firstCall.args[0], /Invalid custom uniform declaration/);
    assert.match(logger.warn.secondCall.args[0], /conflicts/);
  });

  test('retains the last valid workspace content after an invalid update', async () => {
    const manager = createManager();
    await manager.apply({ kind: 'valid', snapshot });
    fs.writeFileSync.resetHistory();
    fs.renameSync.resetHistory();
    fs.existsSync.withArgs(destination).returns(true);
    fs.readFileSync.withArgs(destination, 'utf8').returns('stale content');

    await manager.apply({ kind: 'invalid', shaderPath });

    const retainedContent = fs.writeFileSync.firstCall.args[1] as string;
    assert.match(retainedContent, /Config: image\.sha\.json/);
    assert.match(retainedContent, /Pass: Image/);
    sinon.assert.calledOnce(fs.renameSync);
  });

  test('writes a stable shader-local fallback for the first invalid update', async () => {
    const manager = createManager();

    await manager.apply({ kind: 'invalid', shaderPath });

    const fallbackContent = fs.writeFileSync.firstCall.args[1] as string;
    assert.match(fallbackContent, /Active shader: image\.glsl/);
    assert.match(fallbackContent, /Config: none/);
    assert.match(fallbackContent, /Pass: Image/);
  });

  test('keeps last-valid snapshots scoped to their owning workspace', async () => {
    const secondFolder = {
      uri: vscode.Uri.file('/second'),
      name: 'second',
      index: 1,
    };
    const getWorkspaceFolder = vscode.workspace.getWorkspaceFolder as sinon.SinonStub;
    getWorkspaceFolder.callsFake((uri: vscode.Uri) => uri.fsPath.startsWith('/second') ? secondFolder : folder);
    const manager = createManager();
    await manager.apply({ kind: 'valid', snapshot });
    fs.writeFileSync.resetHistory();

    await manager.apply({ kind: 'invalid', shaderPath: '/second/broken.glsl' });

    const fallbackContent = fs.writeFileSync.firstCall.args[1] as string;
    assert.match(fallbackContent, /Active shader: broken\.glsl/);
    assert.match(fallbackContent, /Config: none/);
    assert.doesNotMatch(fallbackContent, /image\.sha\.json/);
  });

  test('retries setting coordination after companion extension installation', async () => {
    getExtension.returns(undefined);
    const manager = createManager();
    await manager.apply({ kind: 'valid', snapshot });
    getExtension.returns(installedExtension);

    assert.ok(extensionListener);
    extensionListener();
    await flushPromises();

    sinon.assert.calledWith(
      configuration.update,
      SHADER_VALIDATOR_PREAMBLE_SETTING,
      managedSetting,
      vscode.ConfigurationTarget.Workspace,
    );
    sinon.assert.calledWith(
      vscode.workspace.getConfiguration as sinon.SinonStub,
      'shader-validator',
      folder.uri,
    );
  });

  for (const failingOperation of ['getExtension', 'getConfiguration', 'get', 'inspect'] as const) {
    test(`catches synchronous ${failingOperation} failure without mutating companion settings`, async () => {
      if (failingOperation === 'getExtension') {
        getExtension.throws(new Error('extension lookup failed'));
      } else if (failingOperation === 'getConfiguration') {
        (vscode.workspace.getConfiguration as sinon.SinonStub).throws(new Error('configuration lookup failed'));
      } else {
        configuration[failingOperation].throws(new Error(`${failingOperation} failed`));
      }
      const manager = createManager();

      await manager.apply({ kind: 'valid', snapshot });

      sinon.assert.calledOnce(logger.error);
      sinon.assert.notCalled(configuration.update);
      sinon.assert.notCalled(showInformationMessage);
    });
  }

  test('treats an unavailable configuration inspection as unset', async () => {
    configuration.inspect.returns(undefined);
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledWith(
      configuration.update,
      SHADER_VALIDATOR_PREAMBLE_SETTING,
      managedSetting,
      vscode.ConfigurationTarget.Workspace,
    );
  });

  test('catches settings and notification errors instead of rejecting apply', async () => {
    configuration.inspect.returns(inspectWith({ globalValue: '/global/user-preamble.glsl' }));
    showInformationMessage.rejects(new Error('notification failed'));
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledOnce(logger.error);

    showInformationMessage.resetBehavior();
    showInformationMessage.resolves(undefined);
    showInformationMessage.resetHistory();
    logger.error.resetHistory();
    configuration.inspect.returns(inspectWith());
    configuration.update.rejects(new Error('settings failed'));

    await manager.apply({ kind: 'valid', snapshot: { ...snapshot, passName: 'Buffer A' } });

    sinon.assert.calledOnce(logger.error);
  });

  test('retries a conflict notification that previously failed to appear', async () => {
    configuration.inspect.returns(inspectWith({ globalValue: '/global/user-preamble.glsl' }));
    showInformationMessage.onFirstCall().rejects(new Error('notification failed'));
    showInformationMessage.onSecondCall().resolves(undefined);
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });
    await manager.apply({ kind: 'valid', snapshot: { ...snapshot, passName: 'Buffer A' } });

    sinon.assert.calledTwice(showInformationMessage);
    sinon.assert.calledOnce(logger.error);
  });

  test('logs and returns when the shader has no owning workspace', async () => {
    (vscode.workspace.getWorkspaceFolder as sinon.SinonStub).returns(undefined);
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledOnce(logger.error);
    sinon.assert.notCalled(fs.writeFileSync);
    sinon.assert.notCalled(configuration.update);
  });

  test('logs and returns when workspace resolution throws', async () => {
    (vscode.workspace.getWorkspaceFolder as sinon.SinonStub).throws(new Error('resolution failed'));
    const manager = createManager();

    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledOnce(logger.error);
    sinon.assert.notCalled(fs.writeFileSync);
    sinon.assert.notCalled(configuration.update);
  });

  test('dispose releases the extension listener and makes later callbacks inert', async () => {
    getExtension.returns(undefined);
    const manager = createManager();
    await manager.apply({ kind: 'valid', snapshot });
    assert.ok(extensionListener);

    manager.dispose();
    getExtension.returns(installedExtension);
    extensionListener();
    await flushPromises();

    sinon.assert.calledOnce(listenerDisposable.dispose);
    sinon.assert.notCalled(configuration.update);
  });

  test('dispose is idempotent and later apply calls are inert', async () => {
    const manager = createManager();

    manager.dispose();
    manager.dispose();
    await manager.apply({ kind: 'valid', snapshot });

    sinon.assert.calledOnce(listenerDisposable.dispose);
    sinon.assert.notCalled(fs.writeFileSync);
    sinon.assert.notCalled(configuration.update);
  });
});
