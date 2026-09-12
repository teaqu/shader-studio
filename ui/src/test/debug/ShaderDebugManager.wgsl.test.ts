import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';
import { debugPlanStrategy } from '../../lib/debugLanguageStrategies';
import type { ShaderConfig } from '@shader-studio/types';

const wgslShader = `fn mainImage(coord: vec2f) -> vec4f {
  var uv: vec2f = coord / iResolution.xy;
  var col: vec3f = vec3f(uv, 0.5);
  col += vec3f(0.1);
  return vec4f(col, 1.0);
}`;

describe('ShaderDebugManager - WGSL language mode', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.setLanguage('wgsl');
    manager.setImageShaderCode(wgslShader);
  });

  function buildWgslRequest(config: ShaderConfig, source: string) {
    return debugPlanStrategy('wgsl')!.buildRequest({
      imageCode: wgslShader,
      originalImageCode: wgslShader,
      config,
      currentLine: 1,
      lineContent: '  let value: f32 = 1.0;',
      filePath: '/simulate.wgsl',
      variablePreview: null,
      imagePassPath: '/image.wgsl',
      bufferPathMap: { Image: '/image.wgsl', Simulate: '/simulate.wgsl' },
      bufferCodes: { Simulate: source },
      slangModules: [],
      getDebugTarget: () => ({ passName: 'Simulate', code: source, config }),
    });
  }

  it('stores the configured language', () => {
    expect(manager.getLanguage()).toBe('wgsl');
  });

  it('includes configured compute metadata in the WGSL workspace and hash', () => {
    const source = '@compute fn simulate() {\n  let value: f32 = 1.0;\n}';
    const withMetadata = buildWgslRequest({
      version: '1.0',
      storage: { particles: { count: 16, elementType: 'f32' } },
      passes: { Image: {}, Simulate: { type: 'compute', path: '/simulate.wgsl', entryPoint: 'simulate' } },
    }, source);
    const changedMetadata = buildWgslRequest({
      version: '1.0',
      storage: { velocity: { count: 16, elementType: 'vec4<f32>' } },
      passes: { Image: {}, Simulate: { type: 'compute', path: '/simulate.wgsl', entryPoint: 'alternate' } },
    }, source);

    expect(withMetadata?.workspace.compute).toEqual({ entryPoint: 'simulate', storageNames: ['particles'] });
    expect(changedMetadata?.workspace.compute).toEqual({ entryPoint: 'alternate', storageNames: ['velocity'] });
    expect(changedMetadata?.workspace.contentHash).not.toBe(withMetadata?.workspace.contentHash);
  });

  it('includes storage types in WGSL requests and invalidates plans when the type changes', () => {
    const config: ShaderConfig = { version: '1', storage: { values: { count: 1, elementType: 'f32' } }, passes: { Image: {}, Simulate: { type: 'compute', path: '/simulate.wgsl' } } };
    const source = '@compute @workgroup_size(1) fn update() {\n  let shade = values[0];\n}';
    const first = buildWgslRequest(config, source)!;
    config.storage!.values.elementType = 'vec4f';
    const second = buildWgslRequest(config, source)!;
    expect(first.workspace.storage).toEqual({ values: { elementType: 'f32' } });
    expect(second.workspace.storage).toEqual({ values: { elementType: 'vec4f' } });
    expect(second.workspace.contentHash).not.toBe(first.workspace.contentHash);
  });

  it('omits compute metadata for a render WGSL workspace', () => {
    const strategy = debugPlanStrategy('wgsl')!;
    const request = strategy.buildRequest({
      imageCode: wgslShader, originalImageCode: wgslShader, config: { version: '1.0', passes: { Image: {} } },
      currentLine: 1, lineContent: '  var uv: vec2f = coord / iResolution.xy;', filePath: '/image.wgsl', variablePreview: null,
      imagePassPath: '/image.wgsl', bufferPathMap: { Image: '/image.wgsl' }, bufferCodes: {}, slangModules: [],
      getDebugTarget: () => ({ passName: 'Image', code: wgslShader, config: { version: '1.0', passes: { Image: {} } } }),
    });
    expect(request?.workspace.compute).toBeUndefined();
  });

  it('builds an in-place WGSL preview plan without calling the GLSL modifier', () => {
    manager.setShaderContext(null, '/flow.wgsl', {});
    manager.toggleEnabled();
    manager.updateDebugLine(1, '  var uv: vec2f = coord / iResolution.xy;', '/flow.wgsl');

    const plan = manager.getPreviewPlan(wgslShader, null);

    expect(plan?.rootUri).toBe('/flow.wgsl');
    expect(plan?.selectedSourceUri).toBe('/flow.wgsl');
    expect(plan?.files[0].source).toContain('_ssdbg_');
    expect(manager.modifyShaderForDebugging(wgslShader, 1)).toBeNull();
  });

  it('does not build a WGSL line preview while inline rendering is disabled', () => {
    manager.setShaderContext(null, '/flow.wgsl', {});
    manager.toggleEnabled();
    manager.updateDebugLine(1, '  var uv: vec2f = coord / iResolution.xy;', '/flow.wgsl');
    manager.setInlineRenderingEnabled(false);

    expect(manager.getPreviewPlan(wgslShader, null)).toBeNull();
  });

  it('still builds an explicit WGSL variable preview while inline rendering is disabled', () => {
    manager.setShaderContext(null, '/flow.wgsl', {});
    manager.toggleEnabled();
    manager.updateDebugLine(3, '  return vec4f(col, 1.0);', '/flow.wgsl');
    manager.setInlineRenderingEnabled(false);
    expect(manager.setVariablePreview({
      varName: 'uv',
      varType: 'vec2f',
      debugLine: 3,
      activeBufferName: 'Image',
      filePath: '/flow.wgsl',
    })).toBe(true);

    expect(manager.getPreviewPlan(wgslShader, null)?.files[0].source).toContain('_ssdbg_');
  });

  it('post-processes the full WGSL mainImage when no inline preview is active', () => {
    manager.toggleEnabled();
    manager.cycleNormalizeMode();
    manager.toggleStep();

    const output = manager.applyFullShaderPostProcessing(wgslShader);

    expect(output).toContain('_ssdbg_full_userMain');
    expect(output).toContain('/ (abs(');
    expect(output).toContain('step(vec3f(0.5000)');
  });

  it('builds a native WGSL capture plan with user slots after the hidden marker', () => {
    manager.setShaderContext(null, '/flow.wgsl', {});
    manager.toggleEnabled();
    manager.updateDebugLine(1, '  var uv: vec2f = coord / iResolution.xy;', '/flow.wgsl');

    const capture = manager.getCapturePlan(wgslShader, null);
    if (!capture || 'error' in capture) {
      throw new Error(capture?.error ?? 'Expected a WGSL capture plan');
    }

    expect(capture.plan.captureSlots[0]).toMatchObject({ index: 0, hidden: true });
    expect(capture.plan.captureSlots[1]).toMatchObject({ index: 1, name: 'coord' });
  });

  it('includes the actual return expression as _dbgReturn for native WGSL capture', () => {
    manager.setShaderContext(null, '/flow.wgsl', {});
    manager.toggleEnabled();
    manager.updateDebugLine(4, '  return vec4f(col, 1.0);', '/flow.wgsl');

    const capture = manager.getCapturePlan(wgslShader, null);
    if (!capture || 'error' in capture) {
      throw new Error(capture?.error ?? 'Expected a WGSL capture plan');
    }

    expect(capture.values).toContainEqual(expect.objectContaining({ name: '_dbgReturn', typeName: 'vec4f' }));
    expect(capture.plan.captureSlots).toContainEqual(expect.objectContaining({ name: '_dbgReturn', typeName: 'vec4f', hidden: false }));
  });

  it('exposes WGSL helper parameters and containing loops in the debug context', () => {
    const helperShader = `fn shade(p: vec2f, gain: f32) -> f32 {
  var value: f32 = 0.0;
  for (var i: i32 = 0; i < 8; i += 1) {
    var sample: f32 = p.x * gain;
    value += sample;
  }
  return value;
}

fn mainImage(coord: vec2f) -> vec4f {
  return vec4f(shade(coord, 0.5));
}`;
    manager.setImageShaderCode(helperShader);
    manager.setShaderContext(null, '/helper.wgsl', {});
    manager.toggleEnabled();
    manager.updateDebugLine(3, '    var sample: f32 = p.x * gain;', '/helper.wgsl');

    expect(manager.getState().functionContext).toMatchObject({
      functionName: 'shade',
      returnType: 'f32',
      isFunction: true,
      parameters: [
        { name: 'p', type: 'vec2f' },
        { name: 'gain', type: 'f32' },
      ],
      loops: [{ loopIndex: 0, lineNumber: 2, loopHeader: expect.stringContaining('for') }],
    });
  });

  it('uses the inspector-hovered WGSL variable rather than the return expression default', () => {
    manager.setShaderContext(null, '/flow.wgsl', {});
    manager.toggleEnabled();
    manager.updateDebugLine(4, '  return vec4f(col, 1.0);', '/flow.wgsl');
    expect(manager.setVariablePreview({
      varName: 'uv',
      varType: 'vec2f',
      debugLine: 3,
      activeBufferName: 'Image',
      filePath: '/flow.wgsl',
    })).toBe(true);

    const plan = manager.getPreviewPlan(wgslShader, null);

    expect(plan?.captureSlots[1]).toMatchObject({ name: 'uv', typeName: 'vec2f' });
  });
  it('includes common definitions when analyzing the image and preserves common source in its plan', () => {
    const image = `fn mainImage(coord: vec2f) -> vec4f {
  let shade = commonShade(coord);
  return vec4f(shade);
}`;
    const common = `fn commonShade(p: vec2f) -> f32 { return p.x; }`;
    const config = { version: '1.0', passes: { Image: {}, common: { path: '/common.wgsl' } } };
    manager.setImageShaderCode(image);
    manager.setShaderContext(config, '/image.wgsl', { common });
    manager.toggleEnabled();
    manager.updateDebugLine(1, '  let shade = commonShade(coord);', '/image.wgsl');
    const plan = manager.getPreviewPlan(image, config);
    expect(plan?.captureSlots[1]).toMatchObject({ name: 'shade', typeName: 'f32' });
    expect(plan?.files.find(file => file.path === '/common.wgsl')?.source).toBe(common);
  });

  it('applies and resets helper parameter overrides and loop caps in preview and capture', () => {
    const code = `fn shade(p: vec2f, gain: f32) -> f32 {
  var value: f32 = 0.0;
  loop {
    value += gain;
    break;
  }
  return value;
}
fn mainImage(coord: vec2f) -> vec4f { return vec4f(shade(coord, 0.1)); }`;
    manager.setImageShaderCode(code);
    manager.setShaderContext(null, '/image.wgsl', {});
    manager.toggleEnabled();
    manager.updateDebugLine(3, '    value += gain;', '/image.wgsl');
    manager.setCustomParameter(1, '0.75');
    manager.setLoopMaxIterations(0, 3);
    const preview = manager.getPreviewPlan(code, null)?.files[0].source;
    expect(preview).toContain('gain: f32 = 0.75;');
    expect(preview).toMatch(/p: vec2f = _ssdbg_\w+_coord \/ iResolution.xy;/);
    expect(preview).toMatch(/_loop0 >= 3u/);
    const capture = manager.getCapturePlan(code, null);
    if (!capture || 'error' in capture) {
      throw new Error('capture failed');
    }
    expect(capture.plan.files[0].source).toContain('gain: f32 = 0.75;');
    expect(capture.plan.files[0].source).toMatch(/_loop0 >= 3u/);
    manager.resetCustomParameters();
    expect(manager.getPreviewPlan(code, null)?.files[0].source).toContain('gain: f32 = 0.5;');
    manager.setLoopMaxIterations(0, null);
    expect(manager.getPreviewPlan(code, null)?.files[0].source).not.toContain('_loop0');
  });

  it('forwards compute entry and storage metadata for native WGSL compute replay plans', () => {
    const compute = `@compute @workgroup_size(8)
fn simulate(@builtin(global_invocation_id) id: vec3u) {
  let value: f32 = f32(id.x);
}`;
    const config = {
      version: '1.0',
      storage: { particles: { count: 16, elementType: 'f32' } },
      passes: { Image: {}, Simulate: { type: 'compute' as const, path: '/simulate.wgsl', entryPoint: 'simulate' } },
    };
    manager.setShaderContext(config, '/image.wgsl', { Simulate: compute });
    manager.toggleEnabled();
    manager.updateDebugLine(2, '  let value: f32 = f32(id.x);', '/simulate.wgsl');

    const preview = manager.getPreviewPlan(wgslShader, config);
    expect(preview?.rootUri).toBe('/simulate.wgsl');
    expect(preview?.files.find((file) => file.path === '/simulate.wgsl')?.source).toContain('_ssdbg_');

    const capture = manager.getCapturePlan(wgslShader, config);
    expect(capture && !('error' in capture)).toBe(true);
  });

});
