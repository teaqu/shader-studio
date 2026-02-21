export type {
  ParameterMode,
  DebugParameterInfo,
  DebugLoopInfo,
  DebugFunctionContext,
} from '@shader-studio/glsl-debug';

import type { DebugFunctionContext } from '@shader-studio/glsl-debug';

export type NormalizeMode = 'off' | 'soft' | 'abs';

export interface ShaderDebugState {
  isEnabled: boolean;        // Debug mode toggle
  currentLine: number | null; // Line being debugged (0-indexed)
  lineContent: string | null; // Content of debug line
  filePath: string | null;    // Path to file being debugged
  isActive: boolean;         // Actually debugging (enabled + valid line)
  functionContext: DebugFunctionContext | null;
  isLineLocked: boolean;
  isInlineRenderingEnabled: boolean; // controls line-by-line debug visualization
  normalizeMode: NormalizeMode;      // 'off' | 'soft' (signed, 0.5=zero) | 'abs' (magnitude, 0=zero)
  isStepEnabled: boolean;            // independent toggle: binary threshold post-processing
  stepEdge: number;                  // threshold value for step (default 0.5)
  debugError: string | null;         // error message when debug line can't be processed
}
