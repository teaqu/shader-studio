// Minimal structural subset of the slang-wasm API that the compiler uses.
// Keeping this narrow makes SlangCompiler trivially unit-testable with a fake
// module and avoids depending on the full generated interface.d.ts.

import type { SlangSourceModule } from "@shader-studio/types";
import type { StorageBindingNode } from "../types/PassGraph";

export interface SlangCompileChannel {
  slot: number;
  key: string;
  kind?: "texture" | "video" | "cubemap" | "audio" | "buffer" | "keyboard";
}

/** Structured-clone-safe options shared by main-thread and worker compilers. */
export interface SlangCompileOptions {
  passName?: string;
  commonCode?: string;
  channels?: SlangCompileChannel[];
  captureMode?: boolean;
  passKind?: "render" | "compute";
  storage?: StorageBindingNode[];
  workgroupSize?: [number, number, number];
  outputLayers?: number;
  hasOutput?: boolean;
  entryPoint?: string;
  customUniforms?: Array<{ name: string; type: string }>;
  modules?: Array<Omit<SlangSourceModule, "ownerPass">>;
  sourcePath?: string;
}

export interface SlangCompileTarget {
  name: string;
  value: number;
}

/** Every object returned by Embind owns a native handle unless it aliases another handle. */
export interface SlangClassHandle {
  isAliasOf(other: SlangClassHandle): boolean;
  delete(): void;
}

export interface SlangEntryPoint extends SlangClassHandle {
  // Opaque handle passed back into createCompositeComponentType.
  readonly _entryPoint?: never;
}

export interface SlangComponentType extends SlangClassHandle {
  link(): SlangComponentType | null;
  getTargetCode(targetIndex: number): string;
}

export interface SlangModule extends SlangComponentType {
  findEntryPointByName(name: string): SlangEntryPoint | null;
}

export interface SlangSession extends SlangClassHandle {
  loadModuleFromSource(source: string, name: string, path: string): SlangModule | null;
  createCompositeComponentType(components: unknown[]): SlangComponentType | null;
}

export interface SlangGlobalSession extends SlangClassHandle {
  createSession(targetValue: number): SlangSession | null;
}

export interface SlangError {
  type: string;
  result: number;
  message: string;
}

/** Embind may hand back a JS array or a vector-like; the compiler handles both. */
export type SlangVectorLike<T> = T[] | { size(): number; get(i: number): T };

export interface SlangModuleApi {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, source: string): void;
    unlink(path: string): void;
    analyzePath(path: string): { exists: boolean };
  };
  createGlobalSession(): SlangGlobalSession | null;
  getCompileTargets(): SlangVectorLike<SlangCompileTarget>;
  getLastError(): SlangError;
  getVersionString?(): string;
}

export function slangVectorToArray<T>(v: SlangVectorLike<T>): T[] {
  if (Array.isArray(v)) {
    return v;
  }
  if (v && typeof (v as { size?: unknown }).size === "function") {
    const out: T[] = [];
    const vec = v as { size(): number; get(i: number): T };
    for (let i = 0; i < vec.size(); i++) {
      out.push(vec.get(i));
    }
    return out;
  }
  return [];
}
