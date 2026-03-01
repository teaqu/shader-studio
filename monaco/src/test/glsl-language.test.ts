import { describe, it, expect } from 'vitest';
import { glslLanguageDefinition } from '../glsl-language';

describe('glslLanguageDefinition', () => {
    it('has required Monarch properties', () => {
        expect(glslLanguageDefinition).toHaveProperty('tokenizer');
        expect(glslLanguageDefinition).toHaveProperty('keywords');
        expect(glslLanguageDefinition).toHaveProperty('types');
        expect(glslLanguageDefinition).toHaveProperty('builtins');
        expect(glslLanguageDefinition).toHaveProperty('operators');
        expect(glslLanguageDefinition).toHaveProperty('symbols');
        expect(glslLanguageDefinition).toHaveProperty('shadertoyUniforms');
    });

    it('keywords array includes expected GLSL keywords', () => {
        const expected = [
            'if', 'else', 'for', 'while', 'return', 'break', 'continue',
            'const', 'uniform', 'varying', 'struct', 'discard', 'precision',
        ];
        for (const kw of expected) {
            expect(glslLanguageDefinition.keywords).toContain(kw);
        }
    });

    it('types array includes vec, mat, and primitive types', () => {
        const expected = [
            'vec2', 'vec3', 'vec4',
            'mat2', 'mat3', 'mat4',
            'float', 'int', 'bool',
        ];
        for (const t of expected) {
            expect(glslLanguageDefinition.types).toContain(t);
        }
    });

    it('builtins includes common GLSL functions', () => {
        const expected = [
            'sin', 'cos', 'normalize', 'length', 'texture', 'mix',
            'dot', 'cross', 'clamp', 'smoothstep', 'abs', 'pow',
        ];
        for (const fn of expected) {
            expect(glslLanguageDefinition.builtins).toContain(fn);
        }
    });

    it('shadertoyUniforms includes iResolution, iTime, iMouse', () => {
        expect(glslLanguageDefinition.shadertoyUniforms).toContain('iResolution');
        expect(glslLanguageDefinition.shadertoyUniforms).toContain('iTime');
        expect(glslLanguageDefinition.shadertoyUniforms).toContain('iMouse');
    });

    it('tokenizer has root state', () => {
        expect(glslLanguageDefinition.tokenizer).toHaveProperty('root');
        expect(Array.isArray(glslLanguageDefinition.tokenizer.root)).toBe(true);
        expect(glslLanguageDefinition.tokenizer.root.length).toBeGreaterThan(0);
    });

    it('tokenizer has whitespace and comment states', () => {
        expect(glslLanguageDefinition.tokenizer).toHaveProperty('whitespace');
        expect(glslLanguageDefinition.tokenizer).toHaveProperty('comment');
    });
});
