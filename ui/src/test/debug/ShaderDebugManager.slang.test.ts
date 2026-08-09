import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';

const slangShader = `float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = float3(uv, 0.5);
    col += float3(0.1);
    return float4(col, 1.0);
}`;

describe('ShaderDebugManager - Slang language mode', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.setLanguage('slang');
    manager.setImageShaderCode(slangShader);
  });

  it('defaults to glsl language', () => {
    expect(new ShaderDebugManager().getLanguage()).toBe('glsl');
  });

  it('stores the configured language', () => {
    expect(manager.getLanguage()).toBe('slang');
  });

  it('builds an in-place Slang preview plan without calling the GLSL modifier', () => {
    manager.setShaderContext(null, '/flow.slang', {});
    manager.toggleEnabled();
    manager.updateDebugLine(2, '    float2 uv = fragCoord / iResolution.xy;', '/flow.slang');

    const plan = manager.getSlangPreviewPlan(slangShader, null);

    expect(plan?.rootUri).toBe('file:///flow.slang');
    expect(plan?.selectedSourceUri).toBe('file:///flow.slang');
    expect(plan?.files[0].source).toContain('_ssdbg_');
  });

  it('builds a native preview plan for the default Slang shader return value', () => {
    const defaultShader = `float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));
    return float4(col, 1.0);
}`;
    manager.setImageShaderCode(defaultShader);
    manager.setShaderContext(null, '/default.slang', {});
    manager.toggleEnabled();
    manager.updateDebugLine(4, '    return float4(col, 1.0);', '/default.slang');

    const plan = manager.getSlangPreviewPlan(defaultShader, null);

    expect(plan?.captureSlots[1]).toMatchObject({ name: '_dbgReturn', typeName: 'float4' });
    const output = plan?.files[0].source ?? '';
    expect(output.indexOf('_executed = true;')).toBeLessThan(output.indexOf('return float4(col, 1.0);'));
  });

  it('uses the inspector-hovered Slang variable rather than the return expression default', () => {
    manager.setShaderContext(null, '/flow.slang', {});
    manager.toggleEnabled();
    manager.updateDebugLine(5, '    return float4(col, 1.0);', '/flow.slang');
    expect(manager.setVariablePreview({
      varName: 'uv',
      varType: 'float2',
      debugLine: 4,
      activeBufferName: 'Image',
      filePath: '/flow.slang',
    })).toBe(true);

    const plan = manager.getSlangPreviewPlan(slangShader, null);

    expect(plan?.captureSlots[1]).toMatchObject({ name: 'uv', typeName: 'float2' });
  });

  it('normalizes the fragment-coordinate built-in for an inspector preview', () => {
    manager.setShaderContext(null, '/flow.slang', {});
    manager.toggleEnabled();
    manager.updateDebugLine(4, '    return float4(col, 1.0);', '/flow.slang');
    expect(manager.setVariablePreview({
      varName: 'fragCoord',
      varType: 'float2',
      debugLine: 4,
      activeBufferName: 'Image',
      filePath: '/flow.slang',
    })).toBe(true);

    const plan = manager.getSlangPreviewPlan(slangShader, null);

    expect(plan?.files[0].source).toMatch(/float4\(_ssdbg_\w+_slot1 \/ iResolution\.xy, 0\.0, 1\.0\)/);
  });

  it('builds a native Slang capture plan with user slots after the hidden marker', () => {
    manager.setShaderContext(null, '/flow.slang', {});
    manager.toggleEnabled();
    manager.updateDebugLine(2, '    float2 uv = fragCoord / iResolution.xy;', '/flow.slang');

    const capture = manager.getSlangCapturePlan(slangShader, null);
    if (!capture || "error" in capture) {
      throw new Error(capture?.error ?? "Expected a Slang capture plan");
    }

    expect(capture.plan.captureSlots[0]).toMatchObject({ index: 0, hidden: true });
    expect(capture.plan.captureSlots[1]).toMatchObject({ index: 1, name: 'fragCoord' });
  });

  it('includes the actual return expression as _dbgReturn for native Slang capture', () => {
    manager.setShaderContext(null, '/flow.slang', {});
    manager.toggleEnabled();
    manager.updateDebugLine(5, '    return float4(col, 1.0);', '/flow.slang');

    const capture = manager.getSlangCapturePlan(slangShader, null);
    if (!capture || "error" in capture) {
      throw new Error(capture?.error ?? "Expected a Slang capture plan");
    }

    expect(capture.values).toContainEqual(expect.objectContaining({ name: '_dbgReturn', typeName: 'float4' }));
    expect(capture.plan.captureSlots).toContainEqual(expect.objectContaining({ name: '_dbgReturn', typeName: 'float4', hidden: false }));
  });

  it('generates GLSL debug output when language is glsl', () => {
    const glslManager = new ShaderDebugManager();
    const glslShader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = vec3(uv, 0.5);
  fragColor = vec4(col, 1.0);
}`;
    glslManager.setImageShaderCode(glslShader);
    glslManager.toggleEnabled();
    glslManager.updateDebugLine(2, '  vec3 col = vec3(uv, 0.5);', 'shader.glsl');

    const result = glslManager.modifyShaderForDebugging(glslShader, 2);

    expect(result).not.toBeNull();
    expect(result).toContain('fragColor = vec4(col, 1.0);');
  });

});
