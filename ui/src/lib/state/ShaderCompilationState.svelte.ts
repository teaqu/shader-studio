import type { CompilationResult } from '../ShaderProcessor';

export class ShaderCompilationState {
  private latestResult = $state.raw<CompilationResult | null>(null);
  private compiling = $state(false);

  get isCompiling(): boolean {
    return this.compiling;
  }

  setCompiling(value: boolean): void {
    this.compiling = value;
  }

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
