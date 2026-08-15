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

  it('does not build a Slang line preview while inline rendering is disabled', () => {
    manager.setShaderContext(null, '/flow.slang', {});
    manager.toggleEnabled();
    manager.updateDebugLine(2, '    float2 uv = fragCoord / iResolution.xy;', '/flow.slang');
    manager.setInlineRenderingEnabled(false);

    expect(manager.getSlangPreviewPlan(slangShader, null)).toBeNull();
  });

  it('still builds an explicit Slang variable preview while inline rendering is disabled', () => {
    manager.setShaderContext(null, '/flow.slang', {});
    manager.toggleEnabled();
    manager.updateDebugLine(4, '    return float4(col, 1.0);', '/flow.slang');
    manager.setInlineRenderingEnabled(false);
    expect(manager.setVariablePreview({
      varName: 'uv',
      varType: 'float2',
      debugLine: 4,
      activeBufferName: 'Image',
      filePath: '/flow.slang',
    })).toBe(true);

    expect(manager.getSlangPreviewPlan(slangShader, null)?.files[0].source).toContain('_ssdbg_');
  });

  it('keeps Image as the workspace root when previewing configured Slang common code', () => {
    const commonPath = '/shaders/common.slang';
    const imagePath = '/shaders/validation.slang';
    const common = `float parityGrid(float2 uv, float scale)
{
    float grid = uv.x * scale;
    return grid;
}`;
    const config = {
      version: '1.0',
      passes: {
        Image: {},
        common: { path: commonPath },
      },
    };
    manager.setShaderContext(config, imagePath, { common }, [], { Image: imagePath, common: commonPath });
    manager.toggleEnabled();
    manager.updateDebugLine(2, '    float grid = uv.x * scale;', commonPath);

    const plan = manager.getSlangPreviewPlan(slangShader, config);

    expect(plan?.rootUri).toBe('file:///shaders/validation.slang');
    expect(plan?.selectedSourceUri).toBe('file:///shaders/common.slang');
    expect(plan?.files.find((file) => file.uri === plan.rootUri)?.source).toContain('mainImage');
    expect(plan?.files.find((file) => file.uri === plan.selectedSourceUri)?.source).toContain('_ssdbg_');
  });

  it('post-processes the full Slang mainImage when no inline preview is active', () => {
    manager.toggleEnabled();
    manager.cycleNormalizeMode();
    manager.toggleStep();

    const output = manager.applyFullShaderPostProcessing(slangShader);

    expect(output).toContain('_ssdbg_full_userMain');
    expect(output).toContain('/ (abs(');
    expect(output).toContain('step(float3(0.5000)');
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

  it('exposes Slang helper parameters and containing loops in the debug context', () => {
    const helperShader = `float shade(float2 p, float gain)
{
    float value = 0.0;
    for (int i = 0; i < 8; i++)
    {
        float sample = p.x * gain;
        value += sample;
    }
    return value;
}

float4 mainImage(float2 fragCoord)
{
    return float4(shade(fragCoord, 0.5));
}`;
    manager.setImageShaderCode(helperShader);
    manager.setShaderContext(null, '/helper.slang', {});
    manager.toggleEnabled();
    manager.updateDebugLine(5, '        float sample = p.x * gain;', '/helper.slang');

    expect(manager.getState().functionContext).toMatchObject({
      functionName: 'shade',
      returnType: 'float',
      isFunction: true,
      parameters: [
        { name: 'p', type: 'float2' },
        { name: 'gain', type: 'float' },
      ],
      loops: [{ loopIndex: 0, lineNumber: 3, endLine: 7, loopHeader: expect.stringContaining('for') }],
    });

    manager.setCustomParameter(1, '0.75');
    manager.setLoopMaxIterations(0, 3);
    const output = manager.getSlangPreviewPlan(helperShader, null)?.files[0].source ?? '';
    expect(output).toContain('float _ssdbg_');
    expect(output).toContain('gain = 0.75;');
    expect(output).toMatch(/if \(_ssdbg_\w+_loop0\+\+ >= 3\) break;/);

    manager.resetCustomParameters();
    expect(manager.getState().functionContext?.parameters).toEqual([
      expect.objectContaining({
        name: 'p',
        expression: 'fragCoord / iResolution.xy',
        defaultExpression: 'fragCoord / iResolution.xy',
      }),
      expect.objectContaining({ name: 'gain', expression: '0.5', defaultExpression: '0.5' }),
    ]);
    const resetOutput = manager.getSlangPreviewPlan(helperShader, null)?.files[0].source ?? '';
    expect(resetOutput).toMatch(/p = _ssdbg_\w+_fragCoord \/ iResolution\.xy;/);
    expect(resetOutput).toContain('gain = 0.5;');

    manager.setCustomParameter(1, '0.50');
    const reformattedOutput = manager.getSlangPreviewPlan(helperShader, null)?.files[0].source ?? '';
    expect(reformattedOutput).toContain('gain = 0.50;');
    const capture = manager.getSlangCapturePlan(helperShader, null);
    if (!capture || 'error' in capture) {
      throw new Error(capture?.error ?? 'Expected helper capture plan');
    }
    expect(capture.plan.files[0].source).toContain('gain = 0.50;');
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

  it('builds a native capture plan for a Slang compute pass', () => {
    const compute = `[shader("compute")]
[numthreads(8, 8, 1)]
void update(uint3 tid : SV_DispatchThreadID)
{
    float value = float(tid.x);
    writeOutput(tid.xy, float4(value));
}`;
    const config = { version: '1.0', passes: {
      Image: { path: 'image.slang', inputs: {} },
      ComputeLife: { type: 'compute' as const, path: 'life.slang', inputs: {} },
    } };
    manager.setShaderContext(config, '/image.slang', { ComputeLife: compute }, [], {
      ComputeLife: '/life.slang',
    });
    manager.toggleEnabled();
    manager.updateDebugLine(4, '    float value = float(tid.x);', '/life.slang');

    const capture = manager.getSlangCapturePlan(slangShader, config);

    if (!capture || 'error' in capture) {
      throw new Error(capture?.error ?? 'Expected compute capture plan');
    }
    expect(capture.values).toContainEqual(expect.objectContaining({ name: 'value', typeName: 'float' }));
    expect(capture.plan.files[0].source).toContain('float4 mainImage(float2 fragCoord)');
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
