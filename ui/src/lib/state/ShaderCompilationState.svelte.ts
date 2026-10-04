import type { CompilationResult } from '../ShaderProcessor';

export class ShaderCompilationState {
  private latestResult = $state.raw<CompilationResult | null>(null);
  private compiling = $state(false);
  private readonly compilationOwners = new Set<object>();

  get isCompiling(): boolean {
    return this.compiling;
  }

  setCompiling(value: boolean, owner: object = this): void {
    if (value) {
      this.compilationOwners.add(owner);
    } else {
      this.compilationOwners.delete(owner);
    }
    this.compiling = this.compilationOwners.size > 0;
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
