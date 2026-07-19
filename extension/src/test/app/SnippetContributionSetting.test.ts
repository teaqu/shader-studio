import * as assert from 'assert';
import {
  applySnippetContributionSetting,
  type SnippetContributionManifest,
} from '../../app/SnippetContributionSetting';
import { SNIPPET_CONTRIBUTIONS } from '../../app/SnippetContributions';

suite('SnippetContributionSetting', () => {
  test('replaces stale snippets with all contributions and preserves unrelated fields', () => {
    const manifest: SnippetContributionManifest = {
      contributes: {
        commands: [{ command: 'shader-studio.view' }],
        snippets: [
          { language: 'glsl', path: './snippets/stale.code-snippets' },
        ],
      },
    };

    applySnippetContributionSetting(manifest, true);

    assert.deepStrictEqual(
      manifest.contributes.snippets,
      SNIPPET_CONTRIBUTIONS,
    );
    assert.deepStrictEqual(manifest.contributes.commands, [
      { command: 'shader-studio.view' },
    ]);
  });

  test('clones the contribution array and each contribution record', () => {
    const manifest: SnippetContributionManifest = { contributes: {} };

    applySnippetContributionSetting(manifest, true);

    const snippets = manifest.contributes.snippets;
    assert.ok(snippets);
    assert.notStrictEqual(snippets, SNIPPET_CONTRIBUTIONS);
    for (const [index, snippet] of snippets.entries()) {
      assert.notStrictEqual(snippet, SNIPPET_CONTRIBUTIONS[index]);
    }

    const originalPath = SNIPPET_CONTRIBUTIONS[0].path;
    snippets[0].path = './snippets/mutated.code-snippets';
    assert.strictEqual(SNIPPET_CONTRIBUTIONS[0].path, originalPath);
  });

  test('deletes snippets when disabled and preserves unrelated fields', () => {
    const manifest: SnippetContributionManifest = {
      contributes: {
        languages: [{ id: 'glsl' }],
        snippets: [
          { language: 'slang', path: './snippets/partial.code-snippets' },
        ],
      },
    };

    applySnippetContributionSetting(manifest, false);

    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(manifest.contributes, 'snippets'),
      false,
    );
    assert.deepStrictEqual(manifest.contributes.languages, [{ id: 'glsl' }]);
  });
});
