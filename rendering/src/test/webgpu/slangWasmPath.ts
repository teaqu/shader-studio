import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Keep the Node WASM filename out of Vite's new-URL asset rewriting. */
export function slangWasmPath(moduleUrl: string = import.meta.url): string {
  return resolve(fileURLToPath(new URL('.', moduleUrl)), '../../../../ui/src/slang/slang-wasm.wasm');
}
