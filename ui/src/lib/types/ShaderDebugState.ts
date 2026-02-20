export type ParameterMode = 'uv' | 'custom';

export interface DebugParameterInfo {
  name: string;              // parameter name from function signature (e.g. "p")
  type: string;              // GLSL type: "vec2", "float", etc.
  uvValue: string;           // UV-derived GLSL expression (e.g. "uv", "uv.x", "vec3(uv, 0.0)")
  defaultCustomValue: string; // initial custom value (e.g. "0.5")
  mode: ParameterMode;       // 'uv' for vec2, 'custom' for others by default
  customValue: string;       // current custom value (editable, starts as defaultCustomValue)
}

export interface DebugLoopInfo {
  loopIndex: number;         // 0-based index of loop in the truncated code
  lineNumber: number;        // line where the loop starts
  loopHeader: string;        // e.g. "for (int i = 0; i < 10; i++)"
  maxIter: number | null;    // null = unlimited (default), number = user-set cap
}

export interface DebugFunctionContext {
  functionName: string;
  returnType: string;
  parameters: DebugParameterInfo[];
  isFunction: boolean;         // false for mainImage/global
  loops: DebugLoopInfo[];     // loops found between function start and debug line
}

export interface ShaderDebugState {
  isEnabled: boolean;        // Debug mode toggle
  currentLine: number | null; // Line being debugged (0-indexed)
  lineContent: string | null; // Content of debug line
  filePath: string | null;    // Path to file being debugged
  isActive: boolean;         // Actually debugging (enabled + valid line)
  functionContext: DebugFunctionContext | null;
  isLineLocked: boolean;
  isInlineRenderingEnabled: boolean; // controls line-by-line debug visualization
}
