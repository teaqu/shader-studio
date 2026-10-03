import { expect, it } from "vitest";
import { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";

async function readPixel(device: GPUDevice, texture: GPUTexture, x: number, y: number): Promise<number[]> {
  const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture, origin: { x, y } }, { buffer, bytesPerRow: 256 }, [1, 1]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    return [...new Float32Array(buffer.getMappedRange(), 0, 4)];
  } finally {
    buffer.destroy();
  }
}

it("preserves distinct MRT values in both feedback banks across resize and clears every bank on reset", async () => {
  const adapter = await navigator.gpu.requestAdapter();
  expect(adapter).not.toBeNull();
  const device = await adapter!.requestDevice();
  const pass = new SlangPassPipeline(device, "rgba8unorm", {
    name: "Scene", width: 2, height: 2, output: "texture", outputCount: 2,
    entryPoints: { vertex: "vertex", fragment: "fragment" }, channels: [], storage: [],
  }, "rgba32float");
  const source = `struct Outputs { @location(0) a: vec4f, @location(1) b: vec4f, }
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { let p=array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }
@fragment fn fragment()->Outputs { return Outputs(vec4f(0),vec4f(0)); }`;
  try {
    expect(await pass.rebuild(source)).toEqual([]);
    for (let output = 0; output < 2; output++) {
      for (const [bank, texture] of [pass.getCurrentOutputTexture(output), pass.getPreviousOutputTexture(output)].entries()) {
        const data = new Float32Array(Array.from({ length: 4 }, () => [output + 1, bank + 1, 0.5, 1]).flat());
        device.queue.writeTexture({ texture: texture! }, data, { bytesPerRow: 32 }, [2, 2]);
      }
    }
    pass.swap();
    pass.resize(4, 4);
    for (let output = 0; output < 2; output++) {
      expect(await readPixel(device, pass.getCurrentOutputTexture(output)!, 0, 3)).toEqual([output + 1, 2, 0.5, 1]);
      expect(await readPixel(device, pass.getPreviousOutputTexture(output)!, 0, 3)).toEqual([output + 1, 1, 0.5, 1]);
      expect(await readPixel(device, pass.getCurrentOutputTexture(output)!, 3, 0)).toEqual([0, 0, 0, 0]);
    }
    pass.resize(1, 1);
    for (let output = 0; output < 2; output++) {
      expect(await readPixel(device, pass.getCurrentOutputTexture(output)!, 0, 0)).toEqual([output + 1, 2, 0.5, 1]);
      expect(await readPixel(device, pass.getPreviousOutputTexture(output)!, 0, 0)).toEqual([output + 1, 1, 0.5, 1]);
    }
    pass.resetOutputTextures();
    for (let output = 0; output < 2; output++) {
      expect(await readPixel(device, pass.getCurrentOutputTexture(output)!, 0, 0)).toEqual([0, 0, 0, 0]);
      expect(await readPixel(device, pass.getPreviousOutputTexture(output)!, 0, 0)).toEqual([0, 0, 0, 0]);
    }
  } finally {
    pass.dispose();
    device.destroy();
  }
});
