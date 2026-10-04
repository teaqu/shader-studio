import type { RenderPassNode } from "./SlangPassGraph";
import type { StorageBindingNode } from "../types/PassGraph";
import type { SlangChannelResource } from "./SlangPassPipeline";
type WorkgroupCounts = [number, number, number];

export function resolveWorkgroupCounts(
  pass: RenderPassNode,
  storageLayouts: Map<string, StorageBindingNode>,
  channelResources: SlangChannelResource[],
): WorkgroupCounts | null {
  const dispatch = pass.dispatch ?? { mode: "texel" };
  switch (dispatch.mode) {
    case "texel":
      return [
        Math.ceil(pass.width / pass.workgroupSize[0]),
        Math.ceil(pass.height / pass.workgroupSize[1]),
        1,
      ];
    case "count":
      return [Math.ceil(dispatch.count / pass.workgroupSize[0]), 1, 1];
    case "workgroups":
      return [dispatch.x, dispatch.y, dispatch.z];
    case "cover-storage": {
      const storage = storageLayouts.get(dispatch.name);
      return storage
        ? [Math.ceil(storage.count / pass.workgroupSize[0]), 1, 1]
        : null;
    }
    case "cover-channel": {
      const channel = pass.channels.find(({ key }) => key === dispatch.key);
      const resource = channelResources.find(({ slot }) => slot === channel?.slot);
      const width = resource?.width;
      const height = resource?.height;
      if (
        typeof width !== "number" ||
        typeof height !== "number" ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return null;
      }
      return [
        Math.ceil(width / pass.workgroupSize[0]),
        Math.ceil(height / pass.workgroupSize[1]),
        1,
      ];
    }
  }
}

export function validateWorkgroupCounts(
  passName: string,
  counts: WorkgroupCounts,
  limit: number,
): string | null {
  const axes = ["x", "y", "z"] as const;
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] > limit) {
      return `${passName}: dispatch ${axes[index]} count ${counts[index]} exceeds device limit ${limit}`;
    }
  }
  return null;
}
