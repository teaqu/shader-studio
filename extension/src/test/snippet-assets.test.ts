import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { SNIPPET_CONTRIBUTIONS } from '../app/SnippetContributions';

interface SnippetEntry {
  prefix: string;
  body: string | string[];
  description: string;
  call?: string;
  example?: string | string[];
}

type SnippetRecord = Record<string, SnippetEntry>;

const PAIRS = [
  ['sdf-2d.code-snippets', 'sdf-2d.slang.code-snippets'],
  ['sdf-3d.code-snippets', 'sdf-3d.slang.code-snippets'],
  ['math.code-snippets', 'math.slang.code-snippets'],
  ['coordinates.code-snippets', 'coordinates.slang.code-snippets'],
] as const;

const snippetsDirectory = path.resolve(__dirname, '../../snippets');

function readSnippets(filename: string): SnippetRecord {
  return JSON.parse(
    fs.readFileSync(path.join(snippetsDirectory, filename), 'utf8'),
  ) as SnippetRecord;
}

function allText(entry: SnippetEntry): string {
  return [entry.body, entry.call, entry.example]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => value !== undefined)
    .join('\n');
}

suite('Bundled snippet assets', () => {
  test('all eight contributed snippet files exist', () => {
    assert.strictEqual(SNIPPET_CONTRIBUTIONS.length, 8);

    for (const contribution of SNIPPET_CONTRIBUTIONS) {
      assert.ok(
        fs.existsSync(path.resolve(__dirname, '../..', contribution.path)),
        `${contribution.path} must exist`,
      );
    }
  });

  for (const [glslFilename, slangFilename] of PAIRS) {
    test(`${slangFilename} matches ${glslFilename} entries and metadata`, () => {
      const glsl = readSnippets(glslFilename);
      const slang = readSnippets(slangFilename);

      assert.deepStrictEqual(Object.keys(slang), Object.keys(glsl));

      for (const key of Object.keys(glsl)) {
        assert.strictEqual(slang[key].prefix, glsl[key].prefix, `${key} prefix`);
        assert.strictEqual(
          slang[key].description,
          glsl[key].description,
          `${key} description`,
        );
        assert.ok(
          typeof slang[key].body === 'string' || Array.isArray(slang[key].body),
          `${key} body must be a string or string array`,
        );
      }
    });

    test(`${slangFilename} uses Slang-native syntax`, () => {
      const slang = readSnippets(slangFilename);
      const text = Object.values(slang).map(allText).join('\n');

      assert.doesNotMatch(text, /\b(?:[biu]?vec[234]|mat[234](?:x[234])?)\b/);
      assert.doesNotMatch(text, /\bmix\s*\(/);
      assert.doesNotMatch(text, /\bmod\s*\(/);
      assert.doesNotMatch(text, /\batan\s*\(/);
      assert.doesNotMatch(text, /\bvoid\s+mainImage\s*\(/);
    });
  }
});
