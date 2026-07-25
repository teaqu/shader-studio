import * as assert from 'assert';
import { SlangWorkspaceSnapshotBuilder, type SlangWorkspaceSnapshotHost } from '../../app/SlangWorkspaceSnapshotBuilder';

suite('SlangWorkspaceSnapshotBuilder', () => {
  function host(files: Record<string, string>, openDocuments: SlangWorkspaceSnapshotHost['openDocuments'] = []): SlangWorkspaceSnapshotHost {
    return {
      async findSlangFiles() {
        return Object.keys(files); 
      },
      async readFile(uri) {
        return files[uri]; 
      },
      openDocuments,
    };
  }

  test('uses unsaved source, recursively includes dependencies, and sorts internal paths', async () => {
    const builder = new SlangWorkspaceSnapshotBuilder(host({
      'file:///workspace/image.slang': 'import lib.palette;',
      'file:///workspace/lib/palette.slang': 'string value = "disk";',
      'file:///workspace/z.slang': 'float z;',
    }, [{ uri: 'file:///workspace/lib/palette.slang', source: 'string value = "unsaved";', version: 9 }]));

    const snapshot = await builder.build({
      rootUri: 'file:///workspace', rootFiles: ['file:///workspace/image.slang'], configuredPassFiles: [],
    });
    assert.deepStrictEqual(snapshot.files.map((file) => file.path), [
      '/workspace/image.slang', '/workspace/lib/palette.slang', '/workspace/z.slang',
    ]);
    assert.deepStrictEqual(snapshot.files.find((file) => file.path === '/workspace/lib/palette.slang'), {
      uri: 'file:///workspace/lib/palette.slang', path: '/workspace/lib/palette.slang', source: 'string value = "unsaved";', version: 9,
    });
  });

  test('includes configured/root files omitted by discovery, tolerates missing dependencies, and excludes foreign paths', async () => {
    const builder = new SlangWorkspaceSnapshotBuilder({
      async findSlangFiles() {
        return ['file:///workspace/inside.slang', 'file:///elsewhere/foreign.slang']; 
      },
      async readFile(uri) {
        return { 'file:///workspace/inside.slang': '#include "missing.slang"', 'file:///workspace/pass.slang': 'float p;' }[uri];
      },
      openDocuments: [],
    });
    const snapshot = await builder.build({
      rootUri: 'file:///workspace',
      rootFiles: ['file:///workspace/inside.slang', 'file:///workspace/../escape.slang'],
      configuredPassFiles: ['file:///workspace/pass.slang'],
    });
    assert.deepStrictEqual(snapshot.files.map((file) => file.path), ['/workspace/inside.slang', '/workspace/pass.slang']);
  });

  test('canonicalizes Windows file URI spellings and terminates dependency cycles', async () => {
    const builder = new SlangWorkspaceSnapshotBuilder(host({
      'file:///c:/work/a.slang': '#include "b.slang"',
      'file:///c:/work/b.slang': '#include "a.slang"',
    }));
    const snapshot = await builder.build({
      rootUri: 'file:///C:/work/', rootFiles: ['file:///C:/work/a.slang'], configuredPassFiles: [],
    });
    assert.deepStrictEqual(snapshot.files.map((file) => file.path), ['/workspace/a.slang', '/workspace/b.slang']);
  });
});
