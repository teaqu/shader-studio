import type { SlangSourceModule, VirtualShaderFile } from "@shader-studio/types";

/**
 * The common file as the language service takes it, or nothing when the pass
 * being edited is the common file itself - it already owns those symbols, and
 * handing it its own source would declare every one of them twice.
 */
export function commonAuthoringFile(
  common: { path: string; text: string; version: number } | null,
  activePass: string,
  toUri: (path: string) => string,
): VirtualShaderFile | undefined {
  if (!common || activePass.trim().toLowerCase() === "common") {
    return undefined;
  }
  return { uri: toUri(common.path), text: common.text, version: common.version };
}

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
