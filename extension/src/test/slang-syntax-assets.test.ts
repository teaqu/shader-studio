import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import {
  type IGrammar,
  type IRawGrammar,
  INITIAL,
  Registry,
  parseRawGrammar,
} from 'vscode-textmate';

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

interface SlangGrammar {
  scopeName: string;
  patterns: Array<{ include?: string }>;
}

interface TextMateToken {
  text: string;
  scopes: string[];
}

const extensionDirectory = path.resolve(__dirname, '../..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(extensionDirectory, relativePath), 'utf8'),
  ) as T;
}

function hasScope(token: TextMateToken, scope: string): boolean {
  return token.scopes.some(
    (candidate) => candidate === scope || candidate.startsWith(`${scope}.`),
  );
}

suite('Bundled Slang syntax assets', () => {
  let grammar: IGrammar;

  suiteSetup(async () => {
    const wasm = fs.readFileSync(
      require.resolve('vscode-oniguruma/release/onig.wasm'),
    );
    const wasmArrayBuffer = wasm.buffer.slice(
      wasm.byteOffset,
      wasm.byteOffset + wasm.byteLength,
    ) as ArrayBuffer;
    await loadWASM(wasmArrayBuffer);

    const registry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (sources) => new OnigScanner(sources),
        createOnigString: (value) => new OnigString(value),
      }),
      loadGrammar: async (scopeName): Promise<IRawGrammar | null> => {
        if (scopeName !== 'source.slang') {
          return null;
        }

        const grammarPath = path.join(
          extensionDirectory,
          'syntaxes/slang.tmLanguage.json',
        );
        return parseRawGrammar(fs.readFileSync(grammarPath, 'utf8'), grammarPath);
      },
    });

    const loadedGrammar = await registry.loadGrammar('source.slang');
    assert.ok(loadedGrammar, 'the Slang TextMate grammar must load');
    grammar = loadedGrammar;
  });

  function tokenizeLines(source: string): TextMateToken[][] {
    let ruleStack = INITIAL;

    return source.split('\n').map((line) => {
      const result = grammar.tokenizeLine(line, ruleStack);
      ruleStack = result.ruleStack;
      return result.tokens.map((token) => ({
        text: line.slice(token.startIndex, token.endIndex),
        scopes: token.scopes,
      }));
    });
  }

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

  test('orders all required top-level repositories for tokenization', () => {
    const rawGrammar = readJson<SlangGrammar>(
      'syntaxes/slang.tmLanguage.json',
    );

    assert.strictEqual(rawGrammar.scopeName, 'source.slang');
    assert.deepStrictEqual(
      rawGrammar.patterns.map((pattern) => pattern.include),
      [
        '#comments',
        '#strings',
        '#preprocessor',
        '#attributes',
        '#keywords',
        '#types',
        '#numbers',
      ],
    );
  });

  test('tokenizes representative Slang with native TextMate scopes', () => {
    const lines = tokenizeLines(`// module float4
/* import
Texture2D */
"interface Texture2D"
#language "slang"
module Example;
import Example.Core;
interface Renderer {}
float4 shade(Texture2D texture) { return 1.; }
[shader("fragment")]
[[vk::binding(0, 0)]]
[[cuda::launch_bounds(256)]]`);

    const expectedScopes = [
      [0, '// module float4', 'comment'],
      [4, '#language "slang"', 'meta.preprocessor'],
      [5, 'module', 'keyword.declaration'],
      [6, 'import', 'keyword.declaration'],
      [7, 'interface', 'keyword.declaration'],
      [8, 'float4', 'support.type'],
      [8, 'Texture2D', 'support.type'],
      [8, '1.', 'constant.numeric'],
      [9, '[shader("fragment")]', 'storage.modifier.attribute'],
      [10, '[[vk::binding(0, 0)]]', 'storage.modifier.attribute'],
      [11, '[[cuda::launch_bounds(256)]]', 'storage.modifier.attribute'],
    ] as const;

    for (const [lineIndex, text, scope] of expectedScopes) {
      const token = lines[lineIndex].find((candidate) => candidate.text === text);
      assert.ok(token, `${JSON.stringify(text)} must be emitted as one token`);
      assert.ok(
        hasScope(token, scope),
        `${JSON.stringify(text)} must have a ${scope} scope`,
      );
    }

    assert.strictEqual(
      lines[3].map((token) => token.text).join(''),
      '"interface Texture2D"',
    );
    assert.ok(
      lines[3].every((token) => hasScope(token, 'string')),
      'all string contents must retain a string scope',
    );

    assert.ok(
      [...lines[1], ...lines[2]].every((token) => hasScope(token, 'comment')),
      'multiline block comment contents must retain a comment scope',
    );

    for (const token of [...lines[0], ...lines[1], ...lines[2], ...lines[3]]) {
      assert.ok(!hasScope(token, 'keyword'), `${token.text} must not be a keyword`);
      assert.ok(!hasScope(token, 'support.type'), `${token.text} must not be a type`);
    }
  });

  test('does not treat ordinary array indexing as an attribute', () => {
    const [tokens] = tokenizeLines('float value = samples[index];');
    const bracketTokens = tokens.filter((token) => /[\[\]]/.test(token.text));

    assert.ok(bracketTokens.length > 0);
    assert.ok(
      bracketTokens.every(
        (token) => !hasScope(token, 'storage.modifier.attribute'),
      ),
    );
  });

  test('tokenizes valid numeric forms without accepting mixed suffixes', () => {
    const validNumbers = [
      '1.',
      '.5',
      '1.0f',
      '1f',
      '2h',
      '42u',
      '0xFFu',
      '0b1010',
    ];
    const [validTokens] = tokenizeLines(validNumbers.join(' '));

    for (const number of validNumbers) {
      const token = validTokens.find((candidate) => candidate.text === number);
      assert.ok(token, `${number} must be emitted as one token`);
      assert.ok(hasScope(token, 'constant.numeric'), `${number} must be numeric`);
    }

    for (const invalidNumber of ['1ff', '2ulh', '3.0fu']) {
      const [invalidTokens] = tokenizeLines(invalidNumber);
      assert.ok(
        !invalidTokens.some(
          (token) =>
            token.text === invalidNumber && hasScope(token, 'constant.numeric'),
        ),
        `${invalidNumber} must not be accepted as one numeric token`,
      );
    }

    const [identifierTokens] = tokenizeLines('value1 texture2D');
    assert.ok(
      identifierTokens.every((token) => !hasScope(token, 'constant.numeric')),
      'digits inside identifiers must not be numeric tokens',
    );
  });

  test('supports Slang comments and editor structure configuration', () => {
    const configuration = readJson<{
      comments?: { lineComment?: string; blockComment?: string[] };
      folding?: { markers?: { start?: string; end?: string } };
      indentationRules?: {
        increaseIndentPattern?: string;
        decreaseIndentPattern?: string;
      };
      wordPattern?: string;
    }>('slang-language-configuration.json');

    assert.strictEqual(configuration.comments?.lineComment, '//');
    assert.deepStrictEqual(configuration.comments?.blockComment, ['/*', '*/']);
    assert.ok(configuration.folding?.markers?.start);
    assert.ok(configuration.folding.markers.end);
    assert.match('// #region Slang', new RegExp(configuration.folding.markers.start));
    assert.match('// #endregion', new RegExp(configuration.folding.markers.end));
    assert.ok(configuration.indentationRules?.increaseIndentPattern);
    assert.ok(configuration.indentationRules.decreaseIndentPattern);
    assert.match('struct Example {', new RegExp(configuration.indentationRules.increaseIndentPattern));
    assert.match('}', new RegExp(configuration.indentationRules.decreaseIndentPattern));

    assert.ok(configuration.wordPattern);
    const words = Array.from(
      'foo-bar a-b -1.25'.matchAll(new RegExp(configuration.wordPattern, 'g')),
      (match) => match[0],
    );
    assert.deepStrictEqual(words, ['foo', 'bar', 'a', 'b', '-1.25']);
  });
});
