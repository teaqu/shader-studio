import * as assert from 'assert';
import { normalizeSlangUri, SlangDependencyGraph } from '../../app/SlangDependencyGraph';

suite('SlangDependencyGraph', () => {
  const root = 'file:///workspace';

  test('parses identifier and dotted imports', () => {
    const graph = new SlangDependencyGraph(root);
    graph.update('file:///workspace/image.slang', `
      import foo;
      import lib.palette;
    `);

    assert.deepStrictEqual([...graph.directDependencies('file:///workspace/image.slang')].sort(), [
      'file:///workspace/foo.slang',
      'file:///workspace/lib.palette.slang',
      'file:///workspace/lib/palette.slang',
    ]);
  });

  test('resolves module imports from the workspace root for a nested importer', () => {
    const graph = new SlangDependencyGraph(root);
    graph.update('file:///workspace/shaders/image.slang', 'import lib.palette; import foo;');
    assert.deepStrictEqual([...graph.directDependencies('file:///workspace/shaders/image.slang')].sort(), [
      'file:///workspace/foo.slang',
      'file:///workspace/lib.palette.slang',
      'file:///workspace/lib/palette.slang',
    ]);
  });

  for (const [syntax, expected] of [
    ['import "quoted.slang";', 'file:///workspace/quoted.slang'],
    ['#include "includes/thing.slang"', 'file:///workspace/includes/thing.slang'],
    ['__include("legacy.slang")', 'file:///workspace/legacy.slang'],
  ]) {
    test(`parses ${syntax}`, () => {
      const graph = new SlangDependencyGraph(root);
      graph.update('file:///workspace/image.slang', syntax);
      assert.deepStrictEqual([...graph.directDependencies('file:///workspace/image.slang')], [expected]);
    });
  }

  test('ignores dependency-looking text in comments and ordinary strings', () => {
    const graph = new SlangDependencyGraph(root);
    graph.update('file:///workspace/image.slang', `
      // import ignored;
      /* #include "also-ignored.slang" */
      string text = "import nope; #include \\\"nope.slang\\\"";
    `);
    assert.deepStrictEqual([...graph.directDependencies('file:///workspace/image.slang')], []);
  });

  for (const newline of ['\n', '\r', '\r\n']) {
    test(`ends line comments at ${JSON.stringify(newline)}`, () => {
      const graph = new SlangDependencyGraph(root);
      graph.update('file:///workspace/image.slang', `// #include "fake.slang"${newline}#include "real.slang"`);
      assert.deepStrictEqual([...graph.directDependencies('file:///workspace/image.slang')], ['file:///workspace/real.slang']);
    });
  }

  test('preserves mixed newline shapes while masking block comments', () => {
    const graph = new SlangDependencyGraph(root);
    graph.update('file:///workspace/image.slang', '/*\r\n#include "fake.slang"\r*/\n#include "real.slang"');
    assert.deepStrictEqual([...graph.directDependencies('file:///workspace/image.slang')], ['file:///workspace/real.slang']);
  });

  for (const [label, literal, expected] of [
    ['multiline raw string', 'R"(import ignored;\n#include "ignored.slang")"', ['file:///workspace/real.slang']],
    ['custom-delimiter raw string', 'R"tag(import ignored; #include "ignored.slang")tag"', ['file:///workspace/real.slang']],
    ['unterminated raw string', 'R"tag(import ignored;\n#include "ignored.slang"', []],
  ]) {
    test(`ignores dependencies in ${label}`, () => {
      const graph = new SlangDependencyGraph(root);
      graph.update('file:///workspace/image.slang', `${literal}\n#include "real.slang"`);
      assert.deepStrictEqual([...graph.directDependencies('file:///workspace/image.slang')], expected);
    });
  }

  test('masks a nonzero-offset custom raw literal without matching an earlier terminator', () => {
    const graph = new SlangDependencyGraph(root);
    graph.update('file:///workspace/image.slang', '/* )tag" */ prefix R"tag(#include "fake.slang")tag"\n#include "real.slang"');
    assert.deepStrictEqual([...graph.directDependencies('file:///workspace/image.slang')], ['file:///workspace/real.slang']);
  });

  test('does not treat invalid raw-like prefixes as raw strings', () => {
    const graph = new SlangDependencyGraph(root);
    graph.update('file:///workspace/image.slang', 'R"invalid delimiter" (later)\n#include "real.slang"');
    assert.deepStrictEqual([...graph.directDependencies('file:///workspace/image.slang')], ['file:///workspace/real.slang']);
  });

  test('resolves relative paths, clears stale edges, and handles cycles', () => {
    const graph = new SlangDependencyGraph(root);
    graph.update('file:///workspace/shaders/image.slang', '#include "../lib/common.slang"');
    graph.update('file:///workspace/lib/common.slang', '#include "../shaders/image.slang"');
    assert.deepStrictEqual([...graph.directDependencies('file:///workspace/shaders/image.slang')], ['file:///workspace/lib/common.slang']);
    assert.deepStrictEqual([...graph.affectedRoots('file:///workspace/lib/common.slang', new Set(['file:///workspace/shaders/image.slang']))], ['file:///workspace/shaders/image.slang']);
    graph.remove('file:///workspace/lib/common.slang');
    assert.deepStrictEqual([...graph.directDependencies('file:///workspace/shaders/image.slang')], ['file:///workspace/lib/common.slang']);
    assert.deepStrictEqual([...graph.affectedRoots('file:///workspace/lib/common.slang', new Set(['file:///workspace/shaders/image.slang']))], ['file:///workspace/shaders/image.slang']);
  });

  test('replaces an updated file’s old outgoing dependency set', () => {
    const graph = new SlangDependencyGraph(root);
    graph.update('file:///workspace/image.slang', '#include "old.slang"');
    graph.update('file:///workspace/image.slang', '#include "new.slang"');
    assert.deepStrictEqual([...graph.directDependencies('file:///workspace/image.slang')], ['file:///workspace/new.slang']);
    assert.deepStrictEqual([...graph.affectedRoots('file:///workspace/old.slang', new Set(['file:///workspace/image.slang']))], []);
  });

  test('keeps file authority and percent encoding canonical and isolated', () => {
    assert.strictEqual(normalizeSlangUri('file://LOCALHOST/workspace%20root/a%23b%25c.slang'), 'file:///workspace%20root/a%23b%25c.slang');
    assert.strictEqual(normalizeSlangUri('file://FOREIGN/workspace%20root/a.slang'), 'file://foreign/workspace%20root/a.slang');
    const graph = new SlangDependencyGraph('file:///workspace%20root');
    graph.update('file://foreign/workspace%20root/image.slang', '#include "inside.slang"');
    assert.deepStrictEqual([...graph.directDependencies('file://foreign/workspace%20root/image.slang')], []);
  });

  test('encodes literal filesystem path operands instead of interpreting them as URL text', () => {
    const graph = new SlangDependencyGraph(root);
    graph.update('file:///workspace/image.slang', 'import "a b#c%d.slang"; #include "λ.slang"');
    assert.deepStrictEqual([...graph.directDependencies('file:///workspace/image.slang')].sort(), [
      'file:///workspace/%CE%BB.slang',
      'file:///workspace/a%20b%23c%25d.slang',
    ]);
  });

  test('finds all roots which own a shared transitive dependency', () => {
    const graph = new SlangDependencyGraph(root);
    graph.update('file:///workspace/image.slang', 'import lib.palette;');
    graph.update('file:///workspace/buffera.slang', '#include "lib/common.slang"');
    graph.update('file:///workspace/lib/palette.slang', 'module lib.palette; #include "common.slang"');
    graph.update('file:///workspace/lib/common.slang', 'float shared;');

    assert.deepStrictEqual(
      [...graph.affectedRoots('file:///workspace/lib/common.slang', new Set([
        'file:///workspace/image.slang',
        'file:///workspace/buffera.slang',
      ]))].sort(),
      ['file:///workspace/buffera.slang', 'file:///workspace/image.slang'],
    );
  });
});
