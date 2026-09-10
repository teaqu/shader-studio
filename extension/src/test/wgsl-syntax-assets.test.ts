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

interface WgslGrammar {
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

suite('Bundled WGSL syntax assets', () => {
  let wgslGrammar: IGrammar;

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
        if (scopeName !== 'source.wgsl') {
          return null;
        }

        const grammarPath = path.join(
          extensionDirectory,
          'syntaxes/wgsl.tmLanguage.json',
        );
        return parseRawGrammar(fs.readFileSync(grammarPath, 'utf8'), grammarPath);
      },
    });

    const loadedWgslGrammar = await registry.loadGrammar('source.wgsl');
    assert.ok(loadedWgslGrammar, 'the WGSL TextMate grammar must load');
    wgslGrammar = loadedWgslGrammar;
  });

  function tokenizeLines(source: string): TextMateToken[][] {
    let ruleStack = INITIAL;

    return source.split('\n').map((line) => {
      const result = wgslGrammar.tokenizeLine(line, ruleStack);
      ruleStack = result.ruleStack;
      return result.tokens.map((token) => ({
        text: line.slice(token.startIndex, token.endIndex),
        scopes: token.scopes,
      }));
    });
  }

  test('contributes the WGSL language configuration and grammar', () => {
    const manifest = readJson<ExtensionManifest>('package.json');
    const language = manifest.contributes.languages.find(
      (contribution) => contribution.id === 'wgsl',
    );
    const grammar = manifest.contributes.grammars.find(
      (contribution) => contribution.language === 'wgsl',
    );

    assert.ok(language, 'the WGSL language contribution must exist');
    assert.deepStrictEqual(language.extensions, ['.wgsl']);
    assert.strictEqual(
      language.configuration,
      './wgsl-language-configuration.json',
    );
    assert.deepStrictEqual(grammar, {
      language: 'wgsl',
      scopeName: 'source.wgsl',
      path: './syntaxes/wgsl.tmLanguage.json',
    });
  });

  test('orders builtins before the generic function-call rule', () => {
    const rawGrammar = readJson<WgslGrammar>(
      'syntaxes/wgsl.tmLanguage.json',
    );

    assert.strictEqual(rawGrammar.scopeName, 'source.wgsl');
    assert.deepStrictEqual(
      rawGrammar.patterns.map((pattern) => pattern.include),
      [
        '#comments',
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
      ],
    );
  });

  test('groups builtin functions by responsibility', () => {
    const rawGrammar = readJson<WgslGrammar>(
      'syntaxes/wgsl.tmLanguage.json',
    );
    const builtinFunctionPatterns =
      rawGrammar.repository['builtin-functions']?.patterns;

    assert.deepStrictEqual(
      builtinFunctionPatterns?.map((pattern) => pattern.name),
      [
        'support.function.trigonometric.wgsl',
        'support.function.exponential.wgsl',
        'support.function.common.wgsl',
        'support.function.geometric.wgsl',
        'support.function.derivative.wgsl',
        'support.function.texture.wgsl',
        'support.function.atomic.wgsl',
        'support.function.packing.wgsl',
        'support.function.synchronization.wgsl',
        'support.function.bit.wgsl',
      ],
    );
    assert.ok(builtinFunctionPatterns?.every((pattern) => pattern.match));
  });

  test('highlights builtin calls, uniforms, and swizzles', () => {
    const [callTokens] = tokenizeLines('let x = sin(x);');
    const sin = callTokens.find((token) => token.text === 'sin');
    assert.ok(sin, 'sin must be emitted as one token');
    assert.ok(hasScope(sin, 'support.function'), 'sin must be a builtin');

    const [textureTokens] = tokenizeLines('textureSampleLevel(t, s, uv, 0);');
    const textureSampleLevel = textureTokens.find(
      (token) => token.text === 'textureSampleLevel',
    );
    assert.ok(textureSampleLevel, 'textureSampleLevel must be one token');
    assert.ok(
      hasScope(textureSampleLevel, 'support.function'),
      'textureSampleLevel must be a builtin',
    );

    const [bitcastTokens] = tokenizeLines('let x = bitcast<f32>(bits);');
    const bitcast = bitcastTokens.find((token) => token.text === 'bitcast');
    assert.ok(bitcast, 'bitcast must be emitted as one token');
    assert.ok(hasScope(bitcast, 'support.function'), 'generic bitcast must be a builtin');

    const [uniformTokens] = tokenizeLines('iTime');
    const iTime = uniformTokens.find((token) => token.text === 'iTime');
    assert.ok(iTime, 'iTime must be emitted as one token');
    assert.ok(
      hasScope(iTime, 'variable.language.uniform.wgsl'),
      'iTime must be scoped as a WGSL uniform',
    );

    const [swizzleTokens] = tokenizeLines('p.xyz');
    const swizzle = swizzleTokens.find((token) => token.text === '.xyz');
    assert.ok(swizzle, '.xyz must be emitted as one token by the swizzle rule');
    assert.ok(hasScope(swizzle, 'variable.other.property.wgsl'), '.xyz must have a swizzle scope');
  });

  test('scopes every uniform the builtin catalog declares for WGSL', () => {
    const scoped = [
      'iResolution', 'iTime', 'iTimeDelta', 'iFrameRate', 'iMouse', 'iFrame',
      'iDate', 'iSampleRate', 'iCameraPos', 'iCameraDir', 'iDispatch',
      'iWorldPosition', 'iNormal', 'iCameraPosition',
    ];
    const unscoped = ['inputs', 'iChannel0', 'iTimeExtra', 'myiTime'];
    const lines = tokenizeLines([...scoped, ...unscoped].join(';\n'));

    scoped.forEach((name, index) => {
      const token = lines[index].find((candidate) => candidate.text === name);
      assert.ok(token, `${name} must be emitted as one token`);
      assert.ok(
        hasScope(token, 'variable.language.uniform.wgsl'),
        `${name} must be scoped as a WGSL uniform`,
      );
    });
    unscoped.forEach((name, index) => {
      const line = lines[scoped.length + index];
      assert.ok(
        !line.some((token) => hasScope(token, 'variable.language.uniform')),
        `${name} must not be scoped as a uniform`,
      );
    });
  });

  test('leaves user-defined calls outside the builtin scope', () => {
    const [tokens] = tokenizeLines('myHelper(x)');
    const call = tokens.find((token) => token.text === 'myHelper');
    assert.ok(call, 'myHelper must be emitted as one token');
    assert.ok(
      !hasScope(call, 'support.function'),
      'myHelper must not be scoped as a builtin',
    );
  });
});
