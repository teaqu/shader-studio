import type { CompilationResult } from '../ShaderProcessor';

export class ShaderCompilationState {
  private latestResult = $state.raw<CompilationResult | null>(null);

  get latest(): CompilationResult | null {
    return this.latestResult;
  }

  setResult(result: CompilationResult): void {
    this.latestResult = result;
  }

  clear(): void {
    this.latestResult = null;
  }
}
