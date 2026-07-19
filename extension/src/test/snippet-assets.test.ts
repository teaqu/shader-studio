import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { SNIPPET_CONTRIBUTIONS } from '../app/SnippetContributions';

interface SnippetEntry {
  prefix: string | string[];
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

function fieldText(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join('\n') : (value ?? '');
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
        assert.deepStrictEqual(slang[key].prefix, glsl[key].prefix, `${key} prefix`);
        assert.strictEqual(
          slang[key].description,
          glsl[key].description,
          `${key} description`,
        );
        assert.ok(
          typeof slang[key].body === 'string' || Array.isArray(slang[key].body),
          `${key} body must be a string or string array`,
        );
        assert.strictEqual(
          Array.isArray(slang[key].body),
          Array.isArray(glsl[key].body),
          `${key} body must preserve the GLSL string or string-array shape`,
        );

        if (
          fieldText(glsl[key].example).includes(
            'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
          )
        ) {
          assert.ok(
            fieldText(slang[key].example).includes(
              'float4 mainImage(float2 fragCoord) {',
            ),
            `${key} Slang example must use the return-style mainImage signature`,
          );
        }
      }
    });

    test(`${slangFilename} uses Slang-native syntax`, () => {
      const slang = readSnippets(slangFilename);
      const text = Object.values(slang).map(allText).join('\n');

      assert.doesNotMatch(text, /\b(?:[biu]?vec[234]|mat[234](?:x[234])?)\b/);
      assert.doesNotMatch(text, /\bmix\s*\(/);
      assert.doesNotMatch(text, /\bmod\s*\(/);
      assert.doesNotMatch(text, /\bfmod\s*\(/);
      assert.doesNotMatch(text, /\batan\s*\(/);
      assert.doesNotMatch(text, /\bvoid\s+mainImage\s*\(/);
    });
  }

  test('preserves GLSL modulo semantics with floor-based translations', () => {
    const sdf2d = readSnippets('sdf-2d.slang.code-snippets');
    const sdf3d = readSnippets('sdf-3d.slang.code-snippets');
    const coordinates = readSnippets('coordinates.slang.code-snippets');

    const starBody = fieldText(sdf2d['SDF 2D Star'].body);
    assert.ok(starBody.includes('float sourceAngle = atan2(p.x, p.y);'));
    assert.ok(
      starBody.includes(
        'sourceAngle - 2.0 * an * floor(sourceAngle / (2.0 * an)) - an',
      ),
    );

    const planeExample = fieldText(sdf3d['SDF 3D Plane'].example);
    assert.ok(
      planeExample.includes('float checkerCoord = floor(p.x) + floor(p.z);'),
    );
    assert.ok(
      planeExample.includes(
        'checkerCoord - 2.0 * floor(checkerCoord / 2.0)',
      ),
    );

    const pmodTranslation =
      'a = a - 2.0 * angle * floor(a / (2.0 * angle)) - angle;';
    assert.ok(
      fieldText(coordinates['Coord Pmod'].body).includes(pmodTranslation),
    );
    assert.ok(
      fieldText(coordinates['Coord Pmod'].example).includes(pmodTranslation),
    );
  });
});
