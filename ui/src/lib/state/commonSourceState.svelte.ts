/**
 * The shader's common pass, as the in-app editor's language service needs it.
 *
 * The editor holds one pass at a time, so a pass parsed on its own knows
 * nothing of the macros and helpers the common file defines - every use of one
 * reads as an undefined identifier. The viewer publishes the common source
 * here as it arrives from the host, and the editor hands it to the language
 * service alongside the pass being edited.
 */
export interface CommonShaderSource {
  path: string;
  text: string;
  /** Raised on every edit: the language service ignores a stale revision. */
  version: number;
}

let source = $state<CommonShaderSource | null>(null);
let version = 0;

export function getCommonShaderSource(): CommonShaderSource | null {
  return source;
}

export function setCommonShaderSource(next: { path: string; text: string } | null): void {
  if (!next?.path) {
    source = null;
    return;
  }
  if (source?.path === next.path && source.text === next.text) {
    return;
  }
  version += 1;
  source = { path: next.path, text: next.text, version };
}

export function clearCommonShaderSource(): void {
  source = null;
}
