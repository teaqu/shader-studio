import { describe, expect, it, vi } from 'vitest';
import { PassRenderer } from '../../webgl/PassRenderer';
import { ShaderPipeline } from '../../webgl/ShaderPipeline';
import type { Pass, ShaderConfig } from '../../models';
import { OrbitCamera } from '../../preview3d/OrbitCamera';
import { passCameraMatrices, passCameraRenderState } from '../../webgl/PassViewerCamera';

describe('GLSL viewer camera defaults', () => {
  it('uses identity for shader camera uniforms and retains default depth and explicit comparisons', () => {
    const camera = new OrbitCamera().getMatrices(1);
    expect(passCameraMatrices(camera)).toBe(camera);
    expect(Array.from(passCameraMatrices(camera, false).viewProjection).map(value => value + 0)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const pass: Pass = { name: 'Image', shaderSrc: '', inputs: {}, geometry: 'cube', useViewerCamera: false };
    expect(passCameraRenderState(pass).depth?.compare).toBe('less-equal');
    expect(passCameraRenderState({ ...pass, useViewerCamera: true }).depth?.compare).toBe('less');
    expect(passCameraRenderState({ ...pass, depth: { compare: 'greater' } }).depth?.compare).toBe('greater');
    expect(passCameraRenderState({ ...pass, geometry: 'fullscreen' }).depth).toBeNull();
  });
  it.each([[undefined, false, false], [true, false, true], [false, true, false], [undefined, undefined, true]])(
    'resolves pass %s over shader %s', (passDefault, shaderDefault, expected) => {
      const pipeline = Object.create(ShaderPipeline.prototype) as {
        buildPasses(code: string, config: ShaderConfig, buffers: Record<string, string>): Pass[];
      };
      const passes = pipeline.buildPasses('', { version: '1.0', webgpu: { useViewerCamera: shaderDefault },
        passes: { Image: { geometry: { type: 'cube' }, useViewerCamera: passDefault } } }, {});
      expect(passes[0]).toMatchObject({ useViewerCamera: expected });
    },
  );

  it('binds identity matrices when camera is disabled', () => {
    const renderer = Object.create(PassRenderer.prototype) as {
      renderer: { SetShaderConstantMat4F: ReturnType<typeof vi.fn>; SetShaderConstant3FV: ReturnType<typeof vi.fn> };
      meshCamera: OrbitCamera; gl: null;
      setCameraUniforms(shader: object, camera: ReturnType<OrbitCamera['getMatrices']>, enabled: boolean): void;
    };
    renderer.renderer = { SetShaderConstantMat4F: vi.fn(), SetShaderConstant3FV: vi.fn() };
    renderer.meshCamera = new OrbitCamera(); renderer.gl = null;
    renderer.setCameraUniforms({}, renderer.meshCamera.getMatrices(1), false);
    const identity = [1, 0, -0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(renderer.renderer.SetShaderConstantMat4F).toHaveBeenCalledWith('_meshView', identity, true);
    expect(renderer.renderer.SetShaderConstantMat4F).toHaveBeenCalledWith('_meshProjection', identity, true);
    expect(renderer.renderer.SetShaderConstant3FV).toHaveBeenCalledWith('iCameraPosition', [0, 0, 0]);
  });
});
