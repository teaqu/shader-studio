import { describe, expect, it } from "vitest";
import { OrbitCamera } from "../../preview3d/OrbitCamera";
import { meshUniformData } from "../../webgpu/MeshUniformData";

const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
describe("viewer camera mesh uniforms", () => {
  it("keeps the viewer camera enabled by default", () => {
    const camera = new OrbitCamera();
    expect(meshUniformData(camera, 100, 100)).toEqual(meshUniformData(camera, 100, 100, true));
    expect(Array.from(meshUniformData(camera, 100, 100).slice(16,32))).not.toEqual(identity);
  });
  it("uses identity matrices and stays unchanged during orbit when disabled", () => {
    const camera = new OrbitCamera();
    const before = meshUniformData(camera, 100, 100, false);
    for (const offset of [0,16,32]) {
      Array.from(before.slice(offset, offset+16)).forEach((value, index) => expect(value).toBeCloseTo(identity[index]!));
    }
    expect(Array.from(before.slice(48,52))).toEqual([0,0,0,1]);
    camera.orbit(60,30);
    expect(meshUniformData(camera, 200, 80, false)).toEqual(before);
    expect(meshUniformData(camera, 100, 100, true)).not.toEqual(before);
  });
});
