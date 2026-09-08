import * as assert from 'assert';
import { definesMainImage, stripCommentsAndStrings } from '../../app/ShaderEntryPoint';

suite('ShaderEntryPoint', () => {
  suite('definesMainImage', () => {
    test('accepts a GLSL definition', () => {
      assert.strictEqual(definesMainImage(
        'void mainImage( out vec4 fragColor, in vec2 fragCoord )\n{\n  fragColor = vec4(1.0);\n}',
      ), true);
    });

    test('accepts a Slang definition, with or without a trailing semantic', () => {
      assert.strictEqual(definesMainImage('float4 mainImage(float2 fragCoord) { return 1; }'), true);
      assert.strictEqual(
        definesMainImage('float4 mainImage(float2 c) : SV_Target { return 1; }'),
        true,
      );
    });

    test('accepts a definition whose parameters span lines', () => {
      assert.strictEqual(definesMainImage(
        'void mainImage(\n  out vec4 fragColor,\n  in vec2 fragCoord\n) {\n}',
      ), true);
    });

    test('accepts a definition separated from its body by a comment', () => {
      assert.strictEqual(definesMainImage(
        'void mainImage(out vec4 o, in vec2 c) /* entry */ {\n}',
      ), true);
    });

    test('rejects a file that only mentions the name in a comment', () => {
      // A helper documenting what it is for. Routed as a shader, it replaced
      // the picture and threw away the real shader's uniform state.
      assert.strictEqual(definesMainImage(
        '// Helpers used by mainImage in dope.glsl.\nfloat helper(float x) { return x * 2.0; }',
      ), false);
    });

    test('rejects a commented-out definition, line or block', () => {
      assert.strictEqual(definesMainImage('// void mainImage(out vec4 o, in vec2 c) {\nfloat f = 1.0;'), false);
      assert.strictEqual(definesMainImage('/*\nvoid mainImage(out vec4 o, in vec2 c) {\n}\n*/\nfloat f = 1.0;'), false);
    });

    test('rejects a name that merely contains the entry point name', () => {
      assert.strictEqual(definesMainImage('vec4 mainImageScale(vec2 c) { return vec4(0.0); }'), false);
      assert.strictEqual(definesMainImage('vec4 preMainImage(vec2 c) { return vec4(0.0); }'), false);
    });

    test('rejects a call to the entry point', () => {
      assert.strictEqual(definesMainImage(
        'void main() {\n  mainImage(fragColor, gl_FragCoord.xy);\n}',
      ), false);
    });

    test('rejects a forward declaration with no body', () => {
      assert.strictEqual(definesMainImage('void mainImage(out vec4 fragColor, in vec2 fragCoord);'), false);
    });

    test('rejects the name inside a string literal', () => {
      assert.strictEqual(definesMainImage('static const char *k = "void mainImage(float2 c) {";'), false);
    });

    test('accepts a definition that follows an attribute holding a string', () => {
      assert.strictEqual(definesMainImage(
        '[shader("fragment")]\nfloat4 mainImage(float2 fragCoord) { return 1; }',
      ), true);
    });

    test('says no about an empty file', () => {
      assert.strictEqual(definesMainImage(''), false);
    });
  });

  suite('stripCommentsAndStrings', () => {
    test('keeps the length and the lines so positions still line up', () => {
      const code = 'float a = 1.0; // note\nfloat b = 2.0;';
      const stripped = stripCommentsAndStrings(code);
      assert.strictEqual(stripped.length, code.length);
      assert.strictEqual(stripped.split('\n').length, code.split('\n').length);
      assert.ok(stripped.includes('float a = 1.0;'));
      assert.ok(!stripped.includes('note'));
    });

    test('leaves an unterminated comment or string blanked to the end', () => {
      assert.strictEqual(stripCommentsAndStrings('float a; /* unterminated').trim(), 'float a;');
      assert.strictEqual(stripCommentsAndStrings('float a; "unterminated').trim(), 'float a;');
    });

    test('does not treat a comment marker inside a string as a comment', () => {
      const stripped = stripCommentsAndStrings('const char *k = "// not a comment"; float a = 1.0;');
      assert.ok(stripped.includes('float a = 1.0;'));
    });
  });
});
