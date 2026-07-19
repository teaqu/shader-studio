import type { ShaderSourceMessage } from '@shader-studio/types';
import type { CompilationResult } from '../ShaderProcessor';

export class ShaderCompilationState {
  private latestResult = $state.raw<CompilationResult | null>(null);
  private readonly latestRequestByScope = new Map<string, number>();

  get latest(): CompilationResult | null {
    return this.latestResult;
  }

  setResult(result: CompilationResult): void {
    this.latestResult = result;
  }

  acceptRequest(message: Pick<ShaderSourceMessage, 'requestId' | 'compileGeneration'>, scope = 'global'): boolean {
    const requestId = message.requestId ?? message.compileGeneration?.id;
    if (requestId === undefined) {
      return true;
    }
    const latest = this.latestRequestByScope.get(scope) ?? 0;
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
