// Minimal structural subset of the slang-wasm API that the compiler uses.
// Keeping this narrow makes SlangCompiler trivially unit-testable with a fake
// module and avoids depending on the full generated interface.d.ts.

export interface SlangCompileTarget {
  name: string;
  value: number;
}

export interface SlangEntryPoint {
  // Opaque handle passed back into createCompositeComponentType.
  readonly _entryPoint?: never;
}

export interface SlangComponentType {
  link(): SlangComponentType | null;
  getTargetCode(targetIndex: number): string;
}

export interface SlangModule extends SlangComponentType {
  findEntryPointByName(name: string): SlangEntryPoint | null;
}

export interface SlangSession {
  loadModuleFromSource(source: string, name: string, path: string): SlangModule | null;
  createCompositeComponentType(components: unknown[]): SlangComponentType | null;
}

export interface SlangGlobalSession {
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
  createGlobalSession(): SlangGlobalSession | null;
  getCompileTargets(): SlangVectorLike<SlangCompileTarget>;
  getLastError(): SlangError;
  getVersionString?(): string;
}

export function slangVectorToArray<T>(v: SlangVectorLike<T>): T[] {
  if (Array.isArray(v)) return v;
  if (v && typeof (v as { size?: unknown }).size === "function") {
    const out: T[] = [];
    const vec = v as { size(): number; get(i: number): T };
    for (let i = 0; i < vec.size(); i++) out.push(vec.get(i));
    return out;
  }
  return [];
}
