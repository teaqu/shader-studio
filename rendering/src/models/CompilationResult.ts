export interface CompilationResult {
  success: boolean;
  errors?: string[];
  warnings?: string[];
  diagnostics?: import("@shader-studio/types").SlangDiagnostic[];
  /**
   * Set when the compile was discarded because a newer compile (or a
   * dispose) landed while it was in flight. Callers should silently drop
   * the result; it is not a user-facing error. The newer compile owns the
   * UI state. success stays false so callers unaware of the flag still
   * behave safely.
   */
  superseded?: true;
}
