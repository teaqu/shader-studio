import { describe, expect, it } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

const GLSL_SHADER = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec3 col = vec3(0.5);
    fragColor = vec4(col, 1.0);
}`;

const WGSL_SHADER = `fn mainImage(coord: vec2f) -> vec4f {
    let col = vec3f(0.5);
    return vec4f(col, 1.0);
}`;

function activateLine(manager: ShaderDebugManager, lineContent: string, filePath: string): void {
  manager.toggleEnabled();
  manager.updateDebugLine(1, lineContent, filePath);
}

describe('ShaderDebugManager language support', () => {
  it('leaves WGSL source untouched when a debug line is active', () => {
    const manager = new ShaderDebugManager();
    manager.setLanguage('wgsl');
    activateLine(manager, '    let col = vec3f(0.5);', '/shaders/image.wgsl');

    expect(manager.modifyShaderForDebugging(WGSL_SHADER, 1)).toBeNull();
  });

  it('still instruments GLSL source when a debug line is active', () => {
    const manager = new ShaderDebugManager();
    manager.setLanguage('glsl');
    activateLine(manager, '    vec3 col = vec3(0.5);', '/shaders/image.glsl');

    expect(manager.modifyShaderForDebugging(GLSL_SHADER, 1)).not.toBeNull();
  });

  it('applies full-shader post-processing for WGSL', () => {
    const manager = new ShaderDebugManager();
    manager.setLanguage('wgsl');
    manager.setNormalizeMode('soft');

    const output = manager.applyFullShaderPostProcessing(WGSL_SHADER);

    expect(output).toContain('_ssdbg_full_userMain');
    expect(output).toContain('fn mainImage(coord: vec2f) -> vec4f');
  });

  it('applies full-shader post-processing for GLSL', () => {
    const manager = new ShaderDebugManager();
    manager.setLanguage('glsl');
    manager.setNormalizeMode('soft');

    expect(manager.applyFullShaderPostProcessing(GLSL_SHADER)).not.toBeNull();
  });
});
