// Minimal structural subset of the slang-wasm API that the compiler uses.
// Keeping this narrow makes SlangCompiler trivially unit-testable with a fake
// module and avoids depending on the full generated interface.d.ts.

import type { SlangSourceModule } from "@shader-studio/types";
import type { StorageBindingNode } from "../types/PassGraph";
import type { GeometryType } from "@shader-studio/types";

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
  geometry?: GeometryType;
  vertexCode?: string;
  storage?: StorageBindingNode[];
  workgroupSize?: [number, number, number];
  outputLayers?: number;
  hasOutput?: boolean;
  outputImageFormat?: "rgba16f" | "rgba32f";
  entryPoint?: string;
  customUniforms?: Array<{ name: string; type: string }>;
  modules?: Array<Omit<SlangSourceModule, "ownerPass">>;
  sourcePath?: string;
}

export interface SlangCompileTarget {
  name: string;
  value: number;
}

export interface SlangEntryPoint {
  // Opaque handle passed back into createCompositeComponentType.
  readonly _entryPoint?: never;
  delete?(): void;
}

export interface SlangComponentType {
  link(): SlangComponentType | null;
  getTargetCode(targetIndex: number): string;
  delete?(): void;
}

export interface SlangModule extends SlangComponentType {
  findEntryPointByName(name: string): SlangEntryPoint | null;
}

export interface SlangSession {
  loadModuleFromSource(source: string, name: string, path: string): SlangModule | null;
  createCompositeComponentType(components: unknown[]): SlangComponentType | null;
  delete?(): void;
}

export interface SlangGlobalSession {
  createSession(targetValue: number): SlangSession | null;
  delete?(): void;
}

export interface SlangError {
  type: string;
  result: number;
  message: string;
}

/** Embind may hand back a JS array or a vector-like; the compiler handles both. */
export type SlangVectorLike<T> = T[] | { size(): number; get(i: number): T };

export interface SlangModuleApi {
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
