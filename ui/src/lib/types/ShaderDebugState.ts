export interface ShaderDebugState {
  isEnabled: boolean;        // Debug mode toggle
  currentLine: number | null; // Line being debugged (0-indexed)
  lineContent: string | null; // Content of debug line
  filePath: string | null;    // Path to file being debugged
  isActive: boolean;         // Actually debugging (enabled + valid line)
}
