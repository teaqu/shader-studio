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
  repository: Record<
    string,
    {
      patterns?: Array<{ name?: string; match?: string }>;
    }
  >;
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
  let slangGrammar: IGrammar;
  let glslGrammar: IGrammar;

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
        const grammarPaths: Record<string, string> = {
          'source.glsl': 'syntaxes/glsl.tmLanguage.json',
          'source.slang': 'syntaxes/slang.tmLanguage.json',
        };
        const relativePath = grammarPaths[scopeName];
        if (!relativePath) {
          return null;
        }

        const grammarPath = path.join(extensionDirectory, relativePath);
        return parseRawGrammar(fs.readFileSync(grammarPath, 'utf8'), grammarPath);
      },
    });

    const loadedSlangGrammar = await registry.loadGrammar('source.slang');
    const loadedGlslGrammar = await registry.loadGrammar('source.glsl');
    assert.ok(loadedSlangGrammar, 'the Slang TextMate grammar must load');
    assert.ok(loadedGlslGrammar, 'the GLSL TextMate grammar must load');
    slangGrammar = loadedSlangGrammar;
    glslGrammar = loadedGlslGrammar;
  });

  function tokenizeLines(
    source: string,
    targetGrammar = slangGrammar,
  ): TextMateToken[][] {
    let ruleStack = INITIAL;

    return source.split('\n').map((line) => {
      const result = targetGrammar.tokenizeLine(line, ruleStack);
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
        '#builtin-functions',
        '#function-definition',
        '#function-call',
        '#numbers',
        '#builtins',
        '#constants',
        '#operators',
        '#swizzle',
        '#punctuation',
      ],
    );
  });

  test('groups type, function, and numeric patterns by responsibility', () => {
    const rawGrammar = readJson<SlangGrammar>(
      'syntaxes/slang.tmLanguage.json',
    );
    const typePatterns = rawGrammar.repository.types.patterns;
    const builtinFunctionPatterns =
      rawGrammar.repository['builtin-functions']?.patterns;
    const functionDefinitionPatterns =
      rawGrammar.repository['function-definition']?.patterns;
    const functionCallPatterns =
      rawGrammar.repository['function-call']?.patterns;
    const numericPatterns = rawGrammar.repository.numbers.patterns;

    assert.deepStrictEqual(
      typePatterns?.map((pattern) => pattern.name),
      [
        'storage.type.matrix.slang',
        'storage.type.vector.slang',
        'storage.type.slang',
        'storage.type.sampler.slang',
        'storage.type.image.slang',
        'storage.type.resource.slang',
      ],
    );
    assert.deepStrictEqual(
      builtinFunctionPatterns?.map((pattern) => pattern.name),
      [
        'support.function.trigonometric.slang',
        'support.function.exponential.slang',
        'support.function.common.slang',
        'support.function.geometric.slang',
        'support.function.matrix.slang',
        'support.function.texture.slang',
        'support.function.fragment.slang',
      ],
    );
    assert.deepStrictEqual(
      functionDefinitionPatterns?.map((pattern) => pattern.match),
      [
        '\\b([A-Za-z_]\\w*)\\s+([A-Za-z_]\\w*)\\s*(?=\\([^)]*\\)\\s*(?::\\s*[A-Za-z_]\\w*)?\\s*\\{)',
      ],
    );
    assert.deepStrictEqual(
      functionCallPatterns?.map((pattern) => pattern.name),
      ['entity.name.function.call.slang'],
    );
    assert.deepStrictEqual(
      numericPatterns?.map((pattern) => pattern.name),
      [
        'invalid.illegal.numeric.leading-zero.slang',
        'constant.numeric.float.slang',
        'constant.numeric.float.slang',
        'constant.numeric.hex.slang',
        'constant.numeric.binary.slang',
        'constant.numeric.octal.slang',
        'constant.numeric.integer.slang',
      ],
    );
    assert.ok(typePatterns?.every((pattern) => pattern.match));
    assert.ok(builtinFunctionPatterns?.every((pattern) => pattern.match));
    assert.ok(functionCallPatterns?.every((pattern) => pattern.match));
    assert.ok(numericPatterns?.every((pattern) => pattern.match));
  });

  test('uses the same theme-facing type scopes as GLSL', () => {
    const pairs = [
      ['float', 'float', 'storage.type'],
      ['vec4', 'float4', 'storage.type.vector'],
      ['mat4', 'float4x4', 'storage.type.matrix'],
      ['sampler2D', 'Texture2D', 'storage.type.sampler'],
      ['image2D', 'RWTexture2D', 'storage.type.image'],
    ] as const;

    for (const [glslType, slangType, scope] of pairs) {
      const [glslTokens] = tokenizeLines(glslType, glslGrammar);
      const [slangTokens] = tokenizeLines(slangType);
      const glslToken = glslTokens.find((token) => token.text === glslType);
      const slangToken = slangTokens.find((token) => token.text === slangType);

      assert.ok(glslToken, `${glslType} must be emitted as one GLSL token`);
      assert.ok(slangToken, `${slangType} must be emitted as one Slang token`);
      assert.ok(hasScope(glslToken, scope), `${glslType} must have ${scope}`);
      assert.ok(hasScope(slangToken, scope), `${slangType} must have ${scope}`);
    }
  });

  test('uses GLSL theme scopes for every comparable token category', () => {
    const parityCases = [
      ['//comment', '//comment', 'comment', 'comment'],
      ['"text"', '"text"', 'text', 'string.quoted.double'],
      ['#if 1', '#if 1', 'if', 'keyword.control.directive'],
      ['return', 'return', 'return', 'keyword.control.flow'],
      ['const', 'const', 'const', 'storage.modifier'],
      ['vec4', 'float4', 'vec4', 'storage.type.vector'],
      ['sin(value)', 'sin(value)', 'sin', 'support.function.trigonometric'],
      ['shade()', 'shade()', 'shade', 'entity.name.function.call'],
      ['1.5', '1.5', '1.5', 'constant.numeric.float'],
      ['42', '42', '42', 'constant.numeric.integer'],
      ['0xFF', '0xFF', '0xFF', 'constant.numeric.hex'],
      ['077', '077', '077', 'constant.numeric.octal'],
      ['true', 'true', 'true', 'constant.language.boolean'],
      ['iTime', 'iTime', 'iTime', 'variable.other.builtin.shadertoy'],
      ['=', '=', '=', 'keyword.operator.assignment'],
      ['==', '==', '==', 'keyword.operator.comparison'],
      ['+', '+', '+', 'keyword.operator.arithmetic'],
      ['&&', '&&', '&&', 'keyword.operator.logical'],
      ['&', '&', '&', 'keyword.operator.bitwise'],
      ['++', '++', '++', 'keyword.operator.increment-decrement'],
      ['?', '?', '?', 'keyword.operator.ternary'],
      ['value.xyz', 'value.xyz', 'xyz', 'variable.other.property.swizzle'],
      [';', ';', ';', 'punctuation.terminator.statement'],
      [',', ',', ',', 'punctuation.separator.comma'],
      ['{', '{', '{', 'punctuation.section.block.begin'],
      ['}', '}', '}', 'punctuation.section.block.end'],
      ['(', '(', '(', 'punctuation.section.parens.begin'],
      [')', ')', ')', 'punctuation.section.parens.end'],
      ['[', '[', '[', 'punctuation.section.brackets.begin'],
      [']', ']', ']', 'punctuation.section.brackets.end'],
    ] as const;

    for (const [glslSource, slangSource, glslText, scope] of parityCases) {
      const [glslTokens] = tokenizeLines(glslSource, glslGrammar);
      const [slangTokens] = tokenizeLines(slangSource);
      const slangText =
        glslText === 'vec4' && slangSource === 'float4' ? 'float4' : glslText;
      const glslToken = glslTokens.find(
        (token) => token.text === glslText && hasScope(token, scope),
      );
      const slangToken = slangTokens.find(
        (token) => token.text === slangText && hasScope(token, scope),
      );

      assert.ok(glslToken, `GLSL ${JSON.stringify(glslText)} must have ${scope}`);
      assert.ok(
        slangToken,
        `Slang ${JSON.stringify(slangText)} must have ${scope}`,
      );
    }
  });

  test('uses standard scopes for Slang-only tokens', () => {
    const [tokens] = tokenizeLines('0b101 null none');
    const binary = tokens.find((token) => token.text === '0b101');
    const nullValue = tokens.find((token) => token.text === 'null');
    const noneValue = tokens.find((token) => token.text === 'none');

    assert.ok(binary);
    assert.ok(hasScope(binary, 'constant.numeric.binary'));
    assert.ok(nullValue);
    assert.ok(hasScope(nullValue, 'constant.language.null'));
    assert.ok(noneValue);
    assert.ok(hasScope(noneValue, 'constant.language.null'));
  });

  test('uses the same theme-facing function scopes as GLSL', () => {
    const glslLines = tokenizeLines(
      `vec4 shade(vec2 uv) { return vec4(cos(uv.x)); }
void main() { shade(vec2(0.)); }`,
      glslGrammar,
    );
    const slangLines = tokenizeLines(
      `float4 shade(float2 uv) { return float4(cos(uv.x)); }
void main() { shade(float2(0.)); }`,
    );

    const pairs = [
      [glslLines[0], slangLines[0], 'cos', 'support.function.trigonometric'],
      [glslLines[0], slangLines[0], 'vec4', 'storage.type.vector'],
      [glslLines[0], slangLines[0], 'shade', 'entity.name.function'],
      [glslLines[1], slangLines[1], 'shade', 'entity.name.function.call'],
    ] as const;

    for (const [glslTokens, slangTokens, text, scope] of pairs) {
      const glslToken = glslTokens.find(
        (token) => token.text === text && hasScope(token, scope),
      );
      const slangText = text === 'vec4' ? 'float4' : text;
      const slangToken = slangTokens.find(
        (token) => token.text === slangText && hasScope(token, scope),
      );

      assert.ok(glslToken, `GLSL ${text} must have ${scope}`);
      assert.ok(slangToken, `Slang ${slangText} must have ${scope}`);
    }
  });

  test('scopes Slang-native built-ins without leaking into comments or strings', () => {
    const lines = tokenizeLines(`lerp(frac(value), saturate(value), 0.5);
texture.Sample(samplerState, uv);
// lerp Sample
"frac saturate"`);

    for (const text of ['lerp', 'frac', 'saturate']) {
      const token = lines[0].find((candidate) => candidate.text === text);
      assert.ok(token, `${text} must be emitted as one token`);
      assert.ok(hasScope(token, 'support.function.common'));
    }

    const sample = lines[1].find((token) => token.text === 'Sample');
    assert.ok(sample);
    assert.ok(hasScope(sample, 'support.function.texture'));
    assert.ok(lines[2].every((token) => hasScope(token, 'comment')));
    assert.ok(lines[3].every((token) => hasScope(token, 'string')));
    assert.ok(
      [...lines[2], ...lines[3]].every(
        (token) =>
          !hasScope(token, 'support.function') &&
          !hasScope(token, 'entity.name.function'),
      ),
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
float4 shade(Texture2D texture, RWTexture2D output, StructuredBuffer data) { return 1.; }
[shader("fragment")]
[[vk::binding(0, 0)]]
[[cuda::launch_bounds(256)]]`);

    const expectedScopes = [
      [5, 'module', 'keyword.declaration'],
      [6, 'import', 'keyword.declaration'],
      [7, 'interface', 'keyword.declaration'],
      [8, 'float4', 'storage.type.vector'],
      [8, 'Texture2D', 'storage.type.sampler'],
      [8, 'RWTexture2D', 'storage.type.image'],
      [8, 'StructuredBuffer', 'storage.type.resource'],
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
    assert.ok(
      lines[0].every((token) => hasScope(token, 'comment')),
      'line comment contents must retain a comment scope',
    );
    assert.ok(
      lines[4].every((token) => hasScope(token, 'meta.preprocessor')),
      'preprocessor contents must retain a preprocessor scope',
    );

    for (const token of [...lines[0], ...lines[1], ...lines[2], ...lines[3]]) {
      assert.ok(!hasScope(token, 'keyword'), `${token.text} must not be a keyword`);
      assert.ok(!hasScope(token, 'storage.type'), `${token.text} must not be a type`);
    }
  });

  test('keeps custom-delimited raw strings scoped through their terminator', () => {
    const lines = tokenizeLines(`R"tag(raw " quote
module fake;)tag";
float4 value;
R"(empty " quote)";`);

    assert.ok(
      lines[0].every((token) => hasScope(token, 'string.quoted.raw')),
      'the raw string opener and quoted content must have a raw-string scope',
    );
    assert.strictEqual(
      lines[1]
        .filter((token) => hasScope(token, 'string.quoted.raw'))
        .map((token) => token.text)
        .join(''),
      'module fake;)tag"',
    );
    assert.ok(
      lines[1].every((token) => !hasScope(token, 'keyword')),
      'raw string content must not leak into keyword scopes',
    );

    const float4 = lines[2].find((token) => token.text === 'float4');
    assert.ok(float4);
    assert.ok(hasScope(float4, 'storage.type.vector'));

    assert.strictEqual(
      lines[3]
        .filter((token) => hasScope(token, 'string.quoted.raw'))
        .map((token) => token.text)
        .join(''),
      'R"(empty " quote)"',
      'an empty raw-string delimiter must terminate correctly',
    );

    const mismatchedTerminator = tokenizeLines(`R"tag(content)wrong"
interface fake;)tag";
float4 endValue;`);
    assert.ok(
      [...mismatchedTerminator[0], ...mismatchedTerminator[1]].every(
        (token) => !hasScope(token, 'keyword'),
      ),
      'a mismatched delimiter must not terminate the raw string',
    );
    const trailingType = mismatchedTerminator[2].find(
      (token) => token.text === 'float4',
    );
    assert.ok(trailingType);
    assert.ok(hasScope(trailingType, 'storage.type.vector'));
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
      '1e3',
      '123.0LF',
      '1#INFhf',
      '0xC.8p0',
      '0x1p+2F',
      '42u',
      '42Z',
      '42uLL',
      '42LLu',
      '42Uz',
      '42Zu',
      '0',
      '00',
      '10',
      '0xFFu',
      '0b1010',
      '077',
      ...[
        'h',
        'H',
        'hf',
        'HF',
        'fh',
        'FH',
        'f',
        'F',
        'l',
        'L',
        'lf',
        'LF',
        'fl',
        'FL',
      ].map((suffix) => `1.0${suffix}`),
    ];
    const [validTokens] = tokenizeLines(validNumbers.join(' '));

    for (const number of validNumbers) {
      const token = validTokens.find((candidate) => candidate.text === number);
      assert.ok(token, `${number} must be emitted as one token`);
      assert.ok(hasScope(token, 'constant.numeric'), `${number} must be numeric`);
    }

    for (const invalidNumber of [
      '1f',
      '2h',
      '1ff',
      '2ulh',
      '3.0fu',
      '0xC.8',
      '1.0hF',
      '1.0fH',
      '1.0lF',
      '1.0fL',
      '1#INFhF',
      '0xC.8p0fH',
      '09',
      '018',
    ]) {
      const [invalidTokens] = tokenizeLines(invalidNumber);
      assert.ok(
        invalidTokens.every(
          (token) => !hasScope(token, 'constant.numeric'),
        ),
        `${invalidNumber} must not contain a numeric token`,
      );
      if (invalidNumber === '09' || invalidNumber === '018') {
        const invalidToken = invalidTokens.find(
          (token) => token.text === invalidNumber,
        );
        assert.ok(invalidToken, `${invalidNumber} must be consumed whole`);
        assert.ok(hasScope(invalidToken, 'invalid.illegal.numeric'));
      }
    }

    const [identifierTokens] = tokenizeLines('value1 texture2D');
    assert.ok(
      identifierTokens.every((token) => !hasScope(token, 'constant.numeric')),
      'digits inside identifiers must not be numeric tokens',
    );
  });

  test('tokenizes HLSL-derived matrix and documented scalar aliases', () => {
    const validTypes = [
      ['float4x4', 'storage.type.matrix'],
      ['float3x4', 'storage.type.matrix'],
      ['half2x3', 'storage.type.matrix'],
      ['int3x2', 'storage.type.matrix'],
      ['float16_t2x2', 'storage.type.matrix'],
      ['float32_t3x4', 'storage.type.matrix'],
      ['int64_t4x3', 'storage.type.matrix'],
      ['uint8_t2x4', 'storage.type.matrix'],
      ['float16_t', 'storage.type'],
      ['float32_t', 'storage.type'],
      ['float64_t', 'storage.type'],
    ] as const;
    const [validTokens] = tokenizeLines(
      validTypes.map(([type]) => type).join(' '),
    );

    for (const [type, scope] of validTypes) {
      const token = validTokens.find((candidate) => candidate.text === type);
      assert.ok(token, `${type} must be emitted as one token`);
      assert.ok(hasScope(token, scope), `${type} must have ${scope}`);
    }

    const [invalidTokens] = tokenizeLines(
      'float5x5 float4x5 float16_t5x2 afloat4x4 afloat16_t2x2',
    );
    assert.ok(
      invalidTokens.every((token) => !hasScope(token, 'storage.type')),
      'invalid dimensions and embedded type names must remain unscoped',
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

  test('keeps supported numeric literals whole in editor word selection', () => {
    const configuration = readJson<{ wordPattern?: string }>(
      'slang-language-configuration.json',
    );
    assert.ok(configuration.wordPattern);

    const wholeWord = new RegExp(`^(?:${configuration.wordPattern})$`);
    for (const literal of [
      '.5',
      '1.0f',
      '0xFFu',
      '0b1010',
      '1e3f',
      '077',
      '42Z',
      '123.0LF',
      '1#INFhf',
      '1.0HF',
      '1.0FH',
      '1.0FL',
      '0xC.8p0',
      '0',
      '00',
      '10',
      '-1.25',
    ]) {
      assert.match(literal, wholeWord, `${literal} must remain one word`);
    }

    for (const invalidLiteral of [
      '1f',
      '2h',
      '0xC.8',
      '1.0hF',
      '1.0fH',
      '1.0lF',
      '1.0fL',
      '09',
      '018',
    ]) {
      assert.doesNotMatch(
        invalidLiteral,
        wholeWord,
        `${invalidLiteral} must not be treated as one numeric word`,
      );
    }

    const words = Array.from(
      'foo-bar'.matchAll(new RegExp(configuration.wordPattern, 'g')),
      (match) => match[0],
    );
    assert.deepStrictEqual(words, ['foo', 'bar']);
  });
});
