import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface LanguageContribution {
  id: string;
  extensions?: string[];
  configuration?: string;
}

interface GrammarContribution {
  language: string;
  scopeName: string;
  path: string;
}

interface ExtensionManifest {
  contributes: {
    languages: LanguageContribution[];
    grammars: GrammarContribution[];
  };
}

interface GrammarPattern {
  match?: string;
  patterns?: GrammarPattern[];
}

interface SlangGrammar {
  repository: Record<string, GrammarPattern>;
}

const extensionDirectory = path.resolve(__dirname, '../..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(extensionDirectory, relativePath), 'utf8'),
  ) as T;
}

suite('Bundled Slang syntax assets', () => {
  test('contributes the native Slang language configuration and grammar', () => {
    const manifest = readJson<ExtensionManifest>('package.json');
    const language = manifest.contributes.languages.find(
      (contribution) => contribution.id === 'slang',
    );
    const grammar = manifest.contributes.grammars.find(
      (contribution) => contribution.language === 'slang',
    );

    assert.ok(language, 'the Slang language contribution must exist');
    assert.deepStrictEqual(language.extensions, ['.slang']);
    assert.strictEqual(
      language.configuration,
      './slang-language-configuration.json',
    );
    assert.deepStrictEqual(grammar, {
      language: 'slang',
      scopeName: 'source.slang',
      path: './syntaxes/slang.tmLanguage.json',
    });
  });

  test('supports Slang comments and Slang-specific syntax', () => {
    const configuration = readJson<{
      comments?: { lineComment?: string; blockComment?: string[] };
    }>('slang-language-configuration.json');
    const grammar = readJson<SlangGrammar>('syntaxes/slang.tmLanguage.json');

    assert.strictEqual(configuration.comments?.lineComment, '//');
    assert.deepStrictEqual(configuration.comments?.blockComment, ['/*', '*/']);

    const matches = (repositoryEntry: string, syntax: string): boolean => {
      const entry = grammar.repository[repositoryEntry];
      const patterns = entry.patterns ?? [entry];

      return patterns.some(
        (pattern) => pattern.match && new RegExp(pattern.match).test(syntax),
      );
    };

    for (const keyword of ['module', 'import', 'interface']) {
      assert.ok(
        matches('keywords', keyword),
        `the Slang grammar must match the ${keyword} keyword`,
      );
    }

    for (const type of ['float4', 'Texture2D']) {
      assert.ok(
        matches('types', type),
        `the Slang grammar must match the ${type} type`,
      );
    }

    assert.ok(
      matches('attributes', '[shader("fragment")]'),
      'the Slang grammar must match attributes',
    );
    assert.ok(
      matches('preprocessor', '#language glsl'),
      'the Slang grammar must match the #language directive',
    );
  });
});
