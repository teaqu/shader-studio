import type { SlangSourceModule, VirtualShaderFile } from "@shader-studio/types";

export function slangAuthoringVirtualFiles(
  modules: readonly SlangSourceModule[],
  activePass: string,
  toUri: (path: string) => string,
): VirtualShaderFile[] {
  const files = new Map<string, VirtualShaderFile>();
  for (const module of modules) {
    if (module.ownerPass !== activePass || files.has(module.path)) {
      continue;
    }
    files.set(module.path, { uri: toUri(module.path), text: module.source, version: 1 });
  }
  return [...files.values()];
}
