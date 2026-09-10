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

/** Returns Common context for passes; Common itself must not include its own source. */
export function commonAuthoringFile(
  activeBufferName: string,
  commonPath: string | undefined,
  commonSource: string | undefined,
  toUri: (path: string) => string,
): VirtualShaderFile | undefined {
  if (activeBufferName === "common" || activeBufferName === "Common" || !commonPath) {
    return undefined;
  }
  return commonSource === undefined ? undefined : { uri: toUri(commonPath), text: commonSource, version: 1 };
}
