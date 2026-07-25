import * as assert from 'assert';
import { SlangShaderWorkspaceCoordinator, type SlangShaderWorkspaceCoordinatorHost } from '../../app/SlangShaderWorkspaceCoordinator';

suite('SlangShaderWorkspaceCoordinator', () => {
  function createHost(files: Record<string, string>): SlangShaderWorkspaceCoordinatorHost {
    return {
      toUri: (filePath) => `file://${filePath}`,
      toPath: (uri) => new URL(uri).pathname,
      async findSlangFiles() {
        return Object.keys(files); 
      },
      async readFile(uri) {
        return files[uri]; 
      },
      get openDocuments() {
        return []; 
      },
    };
  }

  test('does not let an old owner request replace a newer root', async () => {
    const coordinator = new SlangShaderWorkspaceCoordinator(createHost({
      'file:///work/old.slang': 'void mainImage() {}',
      'file:///work/new.slang': 'void mainImage() {}',
    }));
    const oldRequest = coordinator.beginOwnerRequest('panel:1', '/work/old.slang');
    const newRequest = coordinator.beginOwnerRequest('panel:1', '/work/new.slang');
    const [oldPrepared] = await coordinator.prepareRoots([{ rootPath: '/work/old.slang', configuredFilePaths: [] }]);
    const [newPrepared] = await coordinator.prepareRoots([{ rootPath: '/work/new.slang', configuredFilePaths: [] }]);
    assert.strictEqual(coordinator.commitOwnerRequest(newRequest, newPrepared), true);
    assert.strictEqual(coordinator.commitOwnerRequest(oldRequest, oldPrepared), false);
    assert.deepStrictEqual(coordinator.owningRoots('/work/new.slang'), ['/work/new.slang']);
  });

  test('returns shared owners once in sorted order after a helper edit', async () => {
    const coordinator = new SlangShaderWorkspaceCoordinator(createHost({
      'file:///work/a.slang': '#include "lib.slang"',
      'file:///work/b.slang': '#include "lib.slang"',
      'file:///work/lib.slang': 'float lib;',
    }));
    const [a, b] = await coordinator.prepareRoots([
      { rootPath: '/work/b.slang', configuredFilePaths: [] },
      { rootPath: '/work/a.slang', configuredFilePaths: [] },
    ]);
    coordinator.commitOwnerRequest(coordinator.beginOwnerRequest('a', '/work/a.slang'), a);
    coordinator.commitOwnerRequest(coordinator.beginOwnerRequest('b', '/work/b.slang'), b);
    assert.deepStrictEqual(coordinator.owningRoots('/work/lib.slang', 'float changed;'), ['/work/a.slang', '/work/b.slang']);
  });
});
