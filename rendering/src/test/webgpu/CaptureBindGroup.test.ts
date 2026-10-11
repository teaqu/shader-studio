import { afterEach, expect, it, vi } from "vitest";
import { captureBindGroupLayoutEntries, createCaptureBindGroup } from "../../webgpu/CaptureBindGroup";
import type { StorageBindingNode } from "../../types/PassGraph";

const atomic: StorageBindingNode = {
  name: "counter", binding: 0, elementType: "Counter", builtin: false,
  containsAtomic: true, count: 1, stride: 4,
};

it("limits native writable storage to the fragment stage", () => {
  const entries = captureBindGroupLayoutEntries([], [atomic], true, false);

  expect(entries[1]).toEqual({
    binding: 1,
    visibility: GPUShaderStage.FRAGMENT,
    buffer: { type: "storage" },
  });
});

afterEach(() => vi.unstubAllGlobals());

it('uses standard shader-stage flags when a host omits GPUShaderStage', () => {
  vi.stubGlobal('GPUShaderStage', undefined);
  expect(captureBindGroupLayoutEntries([], [], false, false)[0]?.visibility).toBe(3);
});

it('reports missing uniforms, native mesh snapshots and device creation errors', () => {
  const createBindGroup = vi.fn(() => ({} as GPUBindGroup));
  const device = { createBindGroup } as unknown as GPUDevice;
  const layout = {} as GPUBindGroupLayout;
  const uniform = {} as GPUBuffer;
  const build = (general: GPUBuffer | null, capture: GPUBuffer | null, mesh: GPUBuffer | undefined, native: boolean) =>
    createCaptureBindGroup(device, layout, [], [], [], new Map(), null, general, capture, mesh, native);
  expect(build(null, uniform, undefined, false).error).toContain('uniform buffers');
  expect(build(uniform, null, undefined, false).error).toContain('uniform buffers');
  expect(build(uniform, uniform, undefined, true).error).toContain('mesh capture uniform');
  expect(createCaptureBindGroup(device, layout, [{ slot: 0, key: 'iChannel0' }], [], [], new Map(), null, uniform, uniform, undefined, false).error).toContain('channel resources');
  expect(createBindGroup).not.toHaveBeenCalled();
  createBindGroup.mockImplementation(() => {
    throw new Error('invalid layout');
  });
  expect(build(uniform, uniform, undefined, false).error).toBe('invalid layout');
  createBindGroup.mockImplementation(() => {
    // GPU host shims can reject with strings rather than Error instances.
    // eslint-disable-next-line no-throw-literal
    throw 'lost device';
  });
  expect(build(uniform, uniform, undefined, false).error).toBe('lost device');
});
