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

  test('prepares duplicate root specifications as one sorted transaction with normalized configured files', async () => {
    const coordinator = new SlangShaderWorkspaceCoordinator(createHost({
      'file:///work/a.slang': 'float a;',
      'file:///work/b.slang': 'float b;',
      'file:///work/pass.slang': 'float pass;',
    }));
    const prepared = await coordinator.prepareRoots([
      { rootPath: '/work/b.slang', configuredFilePaths: ['/work/pass.slang', '/work/pass.slang'] },
      { rootPath: '/work/a.slang', configuredFilePaths: [] },
      { rootPath: '/work/b.slang', configuredFilePaths: ['/work/pass.slang'] },
    ]);
    assert.deepStrictEqual(prepared.map((root) => [root.rootPath, root.rootIndex, root.rootCount]), [
      ['/work/a.slang', 0, 2], ['/work/b.slang', 1, 2],
    ]);
    assert.deepStrictEqual(prepared[1].snapshot.files.filter((file) => file.path === '/workspace/pass.slang').length, 1);
  });

  test('keeps all roots in one owner generation current and rejects its stale release', async () => {
    const coordinator = new SlangShaderWorkspaceCoordinator(createHost({
      'file:///work/a.slang': 'float a;', 'file:///work/b.slang': 'float b;',
    }));
    const [first, second] = coordinator.beginOwnerRequests('panel:1', ['/work/b.slang', '/work/a.slang']);
    const prepared = await coordinator.prepareRoots([
      { rootPath: '/work/a.slang', configuredFilePaths: [] }, { rootPath: '/work/b.slang', configuredFilePaths: [] },
    ]);
    assert.strictEqual(coordinator.commitOwnerRequest(first, prepared[0]), true);
    assert.strictEqual(coordinator.commitOwnerRequest(second, prepared[1]), true);
    const replacement = coordinator.beginOwnerRequest('panel:1', '/work/a.slang');
    assert.strictEqual(coordinator.commitOwnerRelease(first), false);
    assert.strictEqual(coordinator.isOwnerRequestCurrent(replacement), true);
  });

  test('keeps dependency cycles routable and ignores a stale release after replacement', async () => {
    const coordinator = new SlangShaderWorkspaceCoordinator(createHost({
      'file:///work/image.slang': '#include "a.slang"',
      'file:///work/a.slang': '#include "b.slang"',
      'file:///work/b.slang': '#include "a.slang"',
    }));
    const stale = coordinator.beginOwnerRequest('panel:1', '/work/image.slang');
    const [prepared] = await coordinator.prepareRoots([{ rootPath: '/work/image.slang', configuredFilePaths: [] }]);
    assert.strictEqual(coordinator.commitOwnerRequest(stale, prepared), true);
    assert.deepStrictEqual(coordinator.owningRoots('/work/b.slang'), ['/work/image.slang']);
    const current = coordinator.beginOwnerRequest('panel:1', '/work/image.slang');
    assert.strictEqual(coordinator.commitOwnerRelease(stale), false);
    assert.strictEqual(coordinator.commitOwnerRequest(current, prepared), true);
  });

  test('commits a multi-root generation atomically only while every request is current', async () => {
    const coordinator = new SlangShaderWorkspaceCoordinator(createHost({
      'file:///work/a.slang': 'float a;', 'file:///work/b.slang': 'float b;',
    }));
    const [a, b] = await coordinator.prepareRoots([
      { rootPath: '/work/a.slang', configuredFilePaths: [] }, { rootPath: '/work/b.slang', configuredFilePaths: [] },
    ]);
    const [aRequest, bRequest] = coordinator.beginOwnerRequests('panel:1', ['/work/a.slang', '/work/b.slang']);
    coordinator.beginOwnerRequest('panel:1', '/work/a.slang');
    assert.strictEqual(coordinator.commitOwnerRequests([{ request: aRequest, prepared: a }, { request: bRequest, prepared: b }]), false);
    assert.deepStrictEqual(coordinator.owningRoots('/work/a.slang'), []);
  });

  test('releasing one shared owner preserves the other and isolates source overlays by workspace snapshot', async () => {
    const coordinator = new SlangShaderWorkspaceCoordinator(createHost({
      'file:///one/image.slang': '#include "lib.slang"', 'file:///one/lib.slang': 'float one;',
      'file:///two/image.slang': '#include "lib.slang"', 'file:///two/lib.slang': 'float two;',
    }));
    const [one] = await coordinator.prepareRoots([{ rootPath: '/one/image.slang', configuredFilePaths: [] }]);
    const [two] = await coordinator.prepareRoots([{ rootPath: '/two/image.slang', configuredFilePaths: [] }]);
    const oneRequest = coordinator.beginOwnerRequest('one', '/one/image.slang');
    const twoRequest = coordinator.beginOwnerRequest('two', '/two/image.slang');
    coordinator.commitOwnerRequest(oneRequest, one);
    coordinator.commitOwnerRequest(twoRequest, two);
    assert.deepStrictEqual(coordinator.owningRoots('/one/lib.slang', 'float oneChanged;'), ['/one/image.slang']);
    coordinator.releaseOwner('one');
    assert.deepStrictEqual(coordinator.owningRoots('/two/lib.slang'), ['/two/image.slang']);
    coordinator.removeRoot('/two/image.slang');
    assert.deepStrictEqual(coordinator.owningRoots('/two/lib.slang'), []);
  });
});
