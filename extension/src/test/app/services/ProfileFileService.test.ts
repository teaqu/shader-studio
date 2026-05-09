import * as assert from 'assert';
import * as sinon from 'sinon';
import type { ProfileIndex, ProfileData } from '@shader-studio/types';

 
const proxyquire = require('proxyquire');

const WORKSPACE_ROOT = '/workspace';

suite('ProfileFileService Test Suite', () => {
  let sandbox: sinon.SinonSandbox;
  let readFileStub: sinon.SinonStub;
  let writeFileStub: sinon.SinonStub;
  let createDirectoryStub: sinon.SinonStub;
  let deleteStub: sinon.SinonStub;
  let ProfileFileService: new (root: string) => import('../../../app/services/ProfileFileService').ProfileFileService;

  setup(() => {
    sandbox = sinon.createSandbox();
    readFileStub = sandbox.stub();
    writeFileStub = sandbox.stub();
    createDirectoryStub = sandbox.stub();
    deleteStub = sandbox.stub();

    const mockVscode = {
      workspace: {
        fs: {
          readFile: readFileStub,
          writeFile: writeFileStub,
          createDirectory: createDirectoryStub,
          delete: deleteStub,
        },
      },
      Uri: {
        file: (p: string) => ({ fsPath: p, toString: () => p }),
      },
    };

    const mod = proxyquire('../../../app/services/ProfileFileService', {
      vscode: mockVscode,
    });
    ProfileFileService = mod.ProfileFileService;
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('readIndex', () => {
    test('returns null when file does not exist', async () => {
      readFileStub.rejects(Object.assign(new Error('FileNotFound'), { code: 'FileNotFound' }));
      const service = new ProfileFileService(WORKSPACE_ROOT);
      const result = await service.readIndex();
      assert.strictEqual(result, null);
    });

    test('returns parsed index when file exists', async () => {
      const index: ProfileIndex = { active: 'default', order: [{ id: 'default', name: 'Default' }] };
      readFileStub.resolves(Buffer.from(JSON.stringify(index)));
      const service = new ProfileFileService(WORKSPACE_ROOT);
      const result = await service.readIndex();
      assert.deepStrictEqual(result, index);
    });

    test('returns null on parse error', async () => {
      readFileStub.resolves(Buffer.from('not valid json{'));
      const service = new ProfileFileService(WORKSPACE_ROOT);
      const result = await service.readIndex();
      assert.strictEqual(result, null);
    });
  });

  suite('writeIndex', () => {
    test('creates directory and writes file', async () => {
      createDirectoryStub.resolves();
      writeFileStub.resolves();
      const index: ProfileIndex = { active: 'default', order: [{ id: 'default', name: 'Default' }] };
      const service = new ProfileFileService(WORKSPACE_ROOT);

      await service.writeIndex(index);

      assert.ok(createDirectoryStub.calledOnce, 'createDirectory should be called once');
      assert.ok(writeFileStub.calledOnce, 'writeFile should be called once');
    });

    test('writes index.json at correct path', async () => {
      createDirectoryStub.resolves();
      writeFileStub.resolves();
      const index: ProfileIndex = { active: 'a', order: [] };
      const service = new ProfileFileService(WORKSPACE_ROOT);

      await service.writeIndex(index);

      const writtenUri = writeFileStub.firstCall.args[0] as { fsPath: string };
      assert.ok(writtenUri.fsPath.endsWith('index.json'), `Expected index.json, got ${writtenUri.fsPath}`);
    });

    test('written bytes decode to the original index', async () => {
      createDirectoryStub.resolves();
      writeFileStub.resolves();
      const index: ProfileIndex = { active: 'default', order: [{ id: 'default', name: 'Default' }] };
      const service = new ProfileFileService(WORKSPACE_ROOT);

      await service.writeIndex(index);

      const writtenBytes: Uint8Array = writeFileStub.firstCall.args[1];
      const decoded = JSON.parse(Buffer.from(writtenBytes).toString('utf-8'));
      assert.deepStrictEqual(decoded, index);
    });
  });

  suite('readProfile', () => {
    test('returns null for missing file', async () => {
      readFileStub.rejects(Object.assign(new Error('FileNotFound'), { code: 'FileNotFound' }));
      const service = new ProfileFileService(WORKSPACE_ROOT);
      const result = await service.readProfile('default');
      assert.strictEqual(result, null);
    });

    test('returns parsed profile data when file exists', async () => {
      const data: ProfileData = {
        theme: 'dark',
        layout: null,
        configPanel: { isVisible: false },
        debugPanel: {
          isVisible: false,
          isVariableInspectorEnabled: false,
          isInlineRenderingEnabled: true,
          isPixelInspectorEnabled: true,
        },
        performancePanel: { isVisible: false },
      };
      readFileStub.resolves(Buffer.from(JSON.stringify(data)));
      const service = new ProfileFileService(WORKSPACE_ROOT);
      const result = await service.readProfile('default');
      assert.deepStrictEqual(result, data);
    });

    test('returns null on parse error', async () => {
      readFileStub.resolves(Buffer.from('{bad json'));
      const service = new ProfileFileService(WORKSPACE_ROOT);
      const result = await service.readProfile('default');
      assert.strictEqual(result, null);
    });
  });

  suite('writeProfile', () => {
    test('writes profile json file', async () => {
      createDirectoryStub.resolves();
      writeFileStub.resolves();
      const data: ProfileData = {
        theme: 'dark',
        layout: null,
        configPanel: { isVisible: false },
        debugPanel: {
          isVisible: false,
          isVariableInspectorEnabled: false,
          isInlineRenderingEnabled: true,
          isPixelInspectorEnabled: true,
        },
        performancePanel: { isVisible: false },
      };
      const service = new ProfileFileService(WORKSPACE_ROOT);

      await service.writeProfile('default', data);

      assert.ok(writeFileStub.calledOnce, 'writeFile should be called once');
    });

    test('writes profile to <id>.json at correct path', async () => {
      createDirectoryStub.resolves();
      writeFileStub.resolves();
      const data: ProfileData = {
        theme: 'light',
        layout: null,
        configPanel: { isVisible: true },
        debugPanel: {
          isVisible: false,
          isVariableInspectorEnabled: false,
          isInlineRenderingEnabled: true,
          isPixelInspectorEnabled: true,
        },
        performancePanel: { isVisible: false },
      };
      const service = new ProfileFileService(WORKSPACE_ROOT);

      await service.writeProfile('wide-editor', data);

      const writtenUri = writeFileStub.firstCall.args[0] as { fsPath: string };
      assert.ok(writtenUri.fsPath.endsWith('wide-editor.json'), `Expected wide-editor.json, got ${writtenUri.fsPath}`);
    });

    test('written bytes decode to original data', async () => {
      createDirectoryStub.resolves();
      writeFileStub.resolves();
      const data: ProfileData = {
        theme: 'dark',
        layout: { panels: [] },
        configPanel: { isVisible: false },
        debugPanel: {
          isVisible: true,
          isVariableInspectorEnabled: true,
          isInlineRenderingEnabled: true,
          isPixelInspectorEnabled: false,
        },
        performancePanel: { isVisible: true },
      };
      const service = new ProfileFileService(WORKSPACE_ROOT);

      await service.writeProfile('my-profile', data);

      const writtenBytes: Uint8Array = writeFileStub.firstCall.args[1];
      const decoded = JSON.parse(Buffer.from(writtenBytes).toString('utf-8'));
      assert.deepStrictEqual(decoded, data);
    });

    test('creates directory before writing', async () => {
      createDirectoryStub.resolves();
      writeFileStub.resolves();
      const data: ProfileData = {
        theme: 'dark',
        layout: null,
        configPanel: { isVisible: false },
        debugPanel: {
          isVisible: false,
          isVariableInspectorEnabled: false,
          isInlineRenderingEnabled: true,
          isPixelInspectorEnabled: true,
        },
        performancePanel: { isVisible: false },
      };
      const service = new ProfileFileService(WORKSPACE_ROOT);

      await service.writeProfile('default', data);

      assert.ok(createDirectoryStub.calledOnce, 'createDirectory should be called once');
    });
  });

  suite('deleteProfile', () => {
    test('calls fs.delete with correct uri', async () => {
      deleteStub.resolves();
      const service = new ProfileFileService(WORKSPACE_ROOT);

      await service.deleteProfile('wide-editor');

      assert.ok(deleteStub.calledOnce, 'delete should be called once');
      const deletedUri = deleteStub.firstCall.args[0] as { fsPath: string };
      assert.ok(deletedUri.fsPath.endsWith('wide-editor.json'), `Expected wide-editor.json, got ${deletedUri.fsPath}`);
    });

    test('does not throw when file does not exist', async () => {
      deleteStub.rejects(Object.assign(new Error('FileNotFound'), { code: 'FileNotFound' }));
      const service = new ProfileFileService(WORKSPACE_ROOT);

      await assert.doesNotReject(() => service.deleteProfile('nonexistent'));
    });
  });
});
