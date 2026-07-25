import type { ShaderSourceMessage } from '@shader-studio/types';
import type { CompilationResult } from '../ShaderProcessor';

export const GLOBAL_SHADER_REQUEST_SCOPE = 'global';

export function getShaderRequestScope(messagePath?: string, lockedPath?: string): string {
  return lockedPath ?? messagePath ?? GLOBAL_SHADER_REQUEST_SCOPE;
}

export class ShaderCompilationState {
  private latestResult = $state.raw<CompilationResult | null>(null);
  private latestRequestByScope = new Map<string, number>();
  private latestRequestId = 0;

  get latest(): CompilationResult | null {
    return this.latestResult;
  }

  setResult(result: CompilationResult): void {
    this.latestResult = result;
  }

  acceptRequest(
    message: Pick<ShaderSourceMessage, 'requestId' | 'compileGeneration'>,
    scope: string = GLOBAL_SHADER_REQUEST_SCOPE,
  ): boolean {
    const requestId = message.requestId ?? message.compileGeneration?.id;
    if (requestId === undefined) {
      return true;
    }

    const latestForScope = this.latestRequestByScope.get(scope) ?? 0;
    if (requestId < latestForScope || requestId < this.latestRequestId) {
      return false;
    }

    this.latestRequestByScope.set(scope, requestId);
    this.latestRequestId = Math.max(this.latestRequestId, requestId);
    return true;
  }

  clear(): void {
    this.latestResult = null;
  }
}
