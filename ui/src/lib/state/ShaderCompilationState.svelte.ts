import type { ShaderSourceMessage } from '@shader-studio/types';
import type { CompilationResult } from '../ShaderProcessor';

export const GLOBAL_SHADER_REQUEST_SCOPE = 'global';

export function getShaderRequestScope(
  messagePath?: string,
  lockedPath?: string,
  rootUri?: string,
): string {
  return rootUri
    ?? (lockedPath && messagePath === lockedPath ? lockedPath : messagePath)
    ?? GLOBAL_SHADER_REQUEST_SCOPE;
}

export class ShaderCompilationState {
  private latestResult = $state.raw<CompilationResult | null>(null);
  private readonly latestRequestByScope = new Map<string, number>();

  get latest(): CompilationResult | null {
    return this.latestResult;
  }

  setResult(result: CompilationResult): void {
    this.latestResult = result;
  }

  acceptRequest(
    message: Pick<ShaderSourceMessage, 'requestId' | 'compileGeneration'>,
    scope = GLOBAL_SHADER_REQUEST_SCOPE,
  ): boolean {
    const requestId = message.requestId ?? message.compileGeneration?.id;
    if (requestId === undefined) {
      return true;
    }
    const globalLatest = this.latestRequestByScope.get(GLOBAL_SHADER_REQUEST_SCOPE) ?? 0;
    const scopedLatest = this.latestRequestByScope.get(scope) ?? 0;
    const latest = Math.max(globalLatest, scopedLatest);
    if (requestId < latest) {
      return false;
    }
    this.latestRequestByScope.set(scope, requestId);
    return true;
  }

  clear(): void {
    this.latestResult = null;
  }
}
