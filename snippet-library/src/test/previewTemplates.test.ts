import { describe, it, expect } from 'vitest';
import { buildPreviewShader, stripSnippetPlaceholders } from '../lib/preview/previewTemplates';

describe('stripSnippetPlaceholders', () => {
    it('should replace ${N:value} with value', () => {
        expect(stripSnippetPlaceholders('${1:float} x = ${2:0.0};')).toBe('float x = 0.0;');
    });

    it('should replace ${N|choice1,choice2|} with first choice', () => {
        expect(stripSnippetPlaceholders('${1|float,int,vec3|} x;')).toBe('float x;');
    });

    it('should remove bare $N placeholders', () => {
        expect(stripSnippetPlaceholders('vec3 col = vec3($1);$0')).toBe('vec3 col = vec3();');
    });

    it('should handle multiple placeholders in one line', () => {
        expect(stripSnippetPlaceholders('${1:vec3} ${2:col} = ${3:vec3(1.0)};'))
            .toBe('vec3 col = vec3(1.0);');
    });

    it('should return plain code unchanged', () => {
        expect(stripSnippetPlaceholders('float x = 1.0;')).toBe('float x = 1.0;');
    });
});

describe('buildPreviewShader', () => {
    describe('category templates with call expression', () => {
        it('should build a 2D SDF preview', () => {
            const body = ['float sdCircle(vec2 p, float r) {', '    return length(p) - r;', '}'];
            const result = buildPreviewShader(body, 'sdCircle(p, 0.5)', 'sdf-2d');
            expect(result).not.toBeNull();
            expect(result).toContain('void mainImage');
            expect(result).toContain('sdCircle(p, 0.5)');
            expect(result).toContain('float d =');
        });

        it('should build a 3D SDF preview', () => {
            const body = ['float sdSphere(vec3 p, float r) {', '    return length(p) - r;', '}'];
            const result = buildPreviewShader(body, 'sdSphere(p, 0.5)', 'sdf-3d');
            expect(result).not.toBeNull();
            expect(result).toContain('float map(vec3 p)');
            expect(result).toContain('sdSphere(p, 0.5)');
        });

        it('should build a math preview', () => {
            const body = ['float remap(float v, float a, float b) {', '    return clamp((v - a) / (b - a), 0.0, 1.0);', '}'];
            const result = buildPreviewShader(body, 'remap(uv.x, 0.2, 0.8)', 'math');
            expect(result).not.toBeNull();
            expect(result).toContain('float v =');
        });

        it('should build a coordinates preview', () => {
            const body = ['vec2 rotate(vec2 p, float a) {', '    float c = cos(a), s = sin(a);', '    return mat2(c, -s, s, c) * p;', '}'];
            const result = buildPreviewShader(body, 'rotate(p, 0.5)', 'coordinates');
            expect(result).not.toBeNull();
            expect(result).toContain('vec2 tc =');
        });
    });

    describe('complete shaders', () => {
        it('should return body as-is when it contains mainImage', () => {
            const body = ['void mainImage(out vec4 fragColor, in vec2 fragCoord) {', '    fragColor = vec4(1.0);', '}'];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).toContain('void mainImage');
            expect(result).toContain('fragColor = vec4(1.0)');
        });

        it('should prefer example over body when example contains mainImage', () => {
            const body = ['float x = 1.0;'];
            const example = ['void mainImage(out vec4 fragColor, in vec2 fragCoord) {', '    fragColor = vec4(1.0, 0.0, 0.0, 1.0);', '}'];
            const result = buildPreviewShader(body, undefined, 'custom', example);
            expect(result).toContain('fragColor = vec4(1.0, 0.0, 0.0, 1.0)');
        });
    });

    describe('custom snippets - last-line preview', () => {
        it('should build preview from last line variable declaration (vec3)', () => {
            const body = ['vec3 col = vec3(1.0, 0.0, 0.0);'];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            expect(result).toContain('void mainImage');
            expect(result).toContain('fragColor = vec4(col, 1.0)');
        });

        it('should build preview from last line variable declaration (float)', () => {
            const body = ['float d = length(p) - 0.5;'];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            expect(result).toContain('fragColor = vec4(vec3(d), 1.0)');
        });

        it('should build preview from last line variable declaration (vec2)', () => {
            const body = ['vec2 uv2 = uv * 2.0;'];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            expect(result).toContain('fragColor = vec4(uv2, 0.0, 1.0)');
        });

        it('should build preview from last line variable declaration (vec4)', () => {
            const body = ['vec4 col = vec4(1.0, 0.0, 0.0, 1.0);'];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            expect(result).toContain('fragColor = col');
        });

        it('should build preview from last line variable declaration (mat2)', () => {
            const body = ['mat2 m = mat2(1.0, 0.0, 0.0, 1.0);'];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            expect(result).toContain('fragColor = vec4(m[0], m[1])');
        });

        it('should build preview from last line variable declaration (int)', () => {
            const body = ['int x = 3;'];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            expect(result).toContain('fragColor = vec4(vec3(float(x)), 1.0)');
        });

        it('should build preview from last line variable declaration (bool)', () => {
            const body = ['bool b = true;'];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            expect(result).toContain('b ? 1.0 : 0.0');
        });

        it('should detect standalone function call and capture result', () => {
            const body = [
                'vec3 red() {',
                '    return vec3(1.0, 0.0, 0.0);',
                '}',
                'red();',
            ];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            expect(result).toContain('vec3 _dbgCall = red()');
            expect(result).toContain('fragColor = vec4(_dbgCall, 1.0)');
        });

        it('should not preview void function calls', () => {
            const body = [
                'void doNothing() {',
                '}',
                'doNothing();',
            ];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).toBeNull();
        });

        it('should split function definitions outside mainImage', () => {
            const body = [
                'vec3 red() {',
                '    return vec3(1.0, 0.0, 0.0);',
                '}',
                'vec3 col = red();',
            ];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            // Function should be BEFORE mainImage, not inside it
            const mainImageIdx = result!.indexOf('void mainImage');
            const funcIdx = result!.indexOf('vec3 red()');
            expect(funcIdx).toBeLessThan(mainImageIdx);
        });

        it('should return null for non-custom snippets without call', () => {
            const body = ['float d = length(p) - 0.5;'];
            const result = buildPreviewShader(body, undefined, 'sdf-2d');
            expect(result).toBeNull();
        });

        it('should return null when last line has no recognizable variable', () => {
            const body = ['// just a comment'];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).toBeNull();
        });

        it('should strip snippet placeholders before building preview', () => {
            const body = ['vec3 ${1:col} = vec3(${2:1.0}, 0.0, 0.0);'];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            expect(result).toContain('vec3 col = vec3(1.0, 0.0, 0.0)');
            expect(result).not.toContain('${');
        });

        it('should use example field for custom snippet last-line preview', () => {
            const body = ['vec3 col = vec3(1.0, 0.0, 0.0);'];
            const example = [
                'vec3 col = vec3(1.0, 0.0, 0.0);',
                'float d = length(p) - 0.3;',
            ];
            const result = buildPreviewShader(body, undefined, 'custom', example);
            expect(result).not.toBeNull();
            // Should use example's last line (float d) for preview
            expect(result).toContain('fragColor = vec4(vec3(d), 1.0)');
        });

        it('should skip trailing comments when finding last line', () => {
            const body = [
                'vec3 col = vec3(1.0, 0.0, 0.0);',
                '// This is a comment',
            ];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            expect(result).toContain('fragColor = vec4(col, 1.0)');
        });

        it('should skip trailing empty lines when finding last line', () => {
            const body = [
                'vec3 col = vec3(1.0, 0.0, 0.0);',
                '',
                '',
            ];
            const result = buildPreviewShader(body, undefined, 'custom');
            expect(result).not.toBeNull();
            expect(result).toContain('fragColor = vec4(col, 1.0)');
        });
    });

    describe('edge cases', () => {
        it('should return null for unknown category without call', () => {
            const body = ['float x = 1.0;'];
            const result = buildPreviewShader(body, 'x', 'ray-marching' as any);
            expect(result).toBeNull();
        });

        it('should return null for empty body', () => {
            const result = buildPreviewShader([], undefined, 'custom');
            expect(result).toBeNull();
        });
    });
});
