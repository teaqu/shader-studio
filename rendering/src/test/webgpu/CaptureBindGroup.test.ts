import { expect, it } from "vitest";
import { captureBindGroupLayoutEntries } from "../../webgpu/CaptureBindGroup";
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
