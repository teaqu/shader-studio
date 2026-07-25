import * as assert from 'assert';
import { SlangDependencyGraph } from '../../app/SlangDependencyGraph';

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
