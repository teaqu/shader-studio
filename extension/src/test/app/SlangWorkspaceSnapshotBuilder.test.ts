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

  test('keeps encoded roots contained, rejects authorities and encoded traversal, and overlays canonical open URIs', async () => {
    const builder = new SlangWorkspaceSnapshotBuilder({
      async findSlangFiles() {
        return [
          'file:///c:/work%20space/image.slang',
          'file://foreign/c:/work%20space/foreign.slang',
          'file:///c:/work%20space/%2e%2e/escape.slang',
        ];
      },
      async readFile(uri) {
        return uri === 'file:///c:/work%20space/image.slang' ? 'float disk;' : undefined;
      },
      openDocuments: [{ uri: 'file:///C:/work%20space/image.slang', source: 'float unsaved;', version: 12 }],
    });
    const snapshot = await builder.build({ rootUri: 'file:///C:/work%20space', rootFiles: [], configuredPassFiles: [] });
    assert.deepStrictEqual(snapshot.files, [{
      uri: 'file:///c:/work%20space/image.slang', path: '/workspace/image.slang', source: 'float unsaved;', version: 12,
    }]);
  });

  test('deduplicates canonical discovery aliases and sorts shuffled discovery deterministically', async () => {
    const makeSnapshot = async (files: readonly string[]) => new SlangWorkspaceSnapshotBuilder({
      async findSlangFiles() {
        return files;
      },
      async readFile(uri) {
        return `${uri} source`;
      },
      openDocuments: [],
    }).build({ rootUri: 'file:///C:/work', rootFiles: [], configuredPassFiles: [] });
    const first = await makeSnapshot(['file:///C:/work/b.slang', 'file:///c:/work/a.slang', 'file:///c:/work/a.slang']);
    const second = await makeSnapshot(['file:///c:/work/a.slang', 'file:///C:/work/b.slang']);
    assert.deepStrictEqual(first.files, second.files);
    assert.deepStrictEqual(first.files.map((file) => file.path), ['/workspace/a.slang', '/workspace/b.slang']);
  });

  test('maps encoded URI segments to decoded internal paths and follows encoded literal dependencies', async () => {
    const builder = new SlangWorkspaceSnapshotBuilder(host({
      'file:///workspace/image.slang': '#include "a b#c%d.slang"',
      'file:///workspace/a%20b%23c%25d.slang': 'float encoded;',
    }));
    const snapshot = await builder.build({ rootUri: 'file:///workspace', rootFiles: ['file:///workspace/image.slang'], configuredPassFiles: [] });
    assert.deepStrictEqual(snapshot.files.map((file) => file.path), ['/workspace/a b#c%d.slang', '/workspace/image.slang']);
  });

  test('recursively loads an omitted but readable encoded dependency', async () => {
    const builder = new SlangWorkspaceSnapshotBuilder({
      async findSlangFiles() {
        return ['file:///workspace/image.slang'];
      },
      async readFile(uri) {
        return {
          'file:///workspace/image.slang': '#include "a b#c%d.slang"',
          'file:///workspace/a%20b%23c%25d.slang': 'float recursive;',
        }[uri];
      },
      openDocuments: [],
    });
    const snapshot = await builder.build({ rootUri: 'file:///workspace', rootFiles: ['file:///workspace/image.slang'], configuredPassFiles: [] });
    assert.deepStrictEqual(snapshot.files.map((file) => [file.path, file.source]), [
      ['/workspace/a b#c%d.slang', 'float recursive;'],
      ['/workspace/image.slang', '#include "a b#c%d.slang"'],
    ]);
  });

  test('excludes the exact workspace root even when every source list supplies it', async () => {
    const builder = new SlangWorkspaceSnapshotBuilder({
      async findSlangFiles() {
        return ['file:///workspace'];
      },
      async readFile() {
        return 'not a file';
      },
      openDocuments: [],
    });
    const snapshot = await builder.build({
      rootUri: 'file:///workspace', rootFiles: ['file:///workspace'], configuredPassFiles: ['file:///workspace'],
    });
    assert.deepStrictEqual(snapshot.files, []);
  });

  test('ignores malformed, foreign-scheme, and query/fragment candidate entries while retaining valid files', async () => {
    const builder = new SlangWorkspaceSnapshotBuilder({
      async findSlangFiles() {
        return ['file:///workspace/discovered.slang', 'not a uri', 'untitled:bad.slang', 'file:///workspace/query.slang?x=1'];
      },
      async readFile(uri) {
        return {
          'file:///workspace/discovered.slang': 'float discovered;',
          'file:///workspace/root.slang': 'float root;',
          'file:///workspace/pass.slang': 'float pass;',
        }[uri];
      },
      openDocuments: [
        { uri: 'file:///workspace/discovered.slang?overlay=1', source: 'bad overlay', version: 1 },
        { uri: 'vscode-remote://host/workspace/remote.slang', source: 'bad', version: 1 },
        { uri: 'file:///workspace/fragment.slang#x', source: 'bad', version: 1 },
      ],
    });
    const snapshot = await builder.build({
      rootUri: 'file:///workspace',
      rootFiles: ['file:///workspace/root.slang', 'file:///workspace/root-fragment.slang#x', 'untitled:root.slang'],
      configuredPassFiles: ['file:///workspace/pass.slang', 'file:///workspace/pass-query.slang?x=1', 'not a uri'],
    });
    assert.deepStrictEqual(snapshot.files.map((file) => [file.path, file.source]), [
      ['/workspace/discovered.slang', 'float discovered;'],
      ['/workspace/pass.slang', 'float pass;'],
      ['/workspace/root.slang', 'float root;'],
    ]);
  });

  test('continues from explicit files when discovery rejects', async () => {
    const builder = new SlangWorkspaceSnapshotBuilder({
      async findSlangFiles() {
        throw new Error('workspace unavailable');
      },
      async readFile(uri) {
        return uri === 'file:///workspace/root.slang' ? 'float root;' : undefined;
      },
      openDocuments: [],
    });
    const snapshot = await builder.build({ rootUri: 'file:///workspace', rootFiles: ['file:///workspace/root.slang'], configuredPassFiles: [] });
    assert.deepStrictEqual(snapshot.files.map((file) => file.path), ['/workspace/root.slang']);
  });

  test('continues after a read race leaves a dependency unavailable', async () => {
    const builder = new SlangWorkspaceSnapshotBuilder({
      async findSlangFiles() {
        return [];
      },
      async readFile(uri) {
        if (uri === 'file:///workspace/missing.slang') {
          throw new Error('deleted');
        }
        return uri === 'file:///workspace/pass.slang' ? 'float pass;' : '#include "missing.slang"';
      },
      openDocuments: [],
    });
    const snapshot = await builder.build({
      rootUri: 'file:///workspace', rootFiles: ['file:///workspace/root.slang'], configuredPassFiles: ['file:///workspace/pass.slang'],
    });
    assert.deepStrictEqual(snapshot.files.map((file) => file.path), ['/workspace/pass.slang', '/workspace/root.slang']);
  });
});
