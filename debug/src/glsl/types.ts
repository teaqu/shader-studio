export type ParameterMode = 'expression';

export interface CaptureVarInfo {
  varName: string;
  varType: string;
  declarationLine: number;  // 0-indexed line where the variable is declared/assigned
}

export interface DebugParameterInfo {
  name: string;              // parameter name from function signature (e.g. "p")
  type: string;              // GLSL type: "vec2", "float", etc.
  uvValue: string;           // UV-derived GLSL expression (e.g. "uv", "uv.x", "vec3(uv, 0.0)")
  centeredUvValue: string;   // Centered UV expression: aspect-corrected, -1 to 1 range
  defaultExpression: string; // initial expression shown in the editor
  expression: string;        // current expression string
}

export interface DebugLoopInfo {
  loopIndex: number;         // sequential index matching capLoopIterations scan order
  lineNumber: number;        // line where the loop header starts
  endLine: number;           // line where the loop's closing } is
  loopHeader: string;        // e.g. "for (int i = 0; i < 10; i++)"
  maxIter: number | null;    // null = unlimited (default), number = user-set cap
}

export interface DebugFunctionContext {
  functionName: string;
  returnType: string;
  parameters: DebugParameterInfo[];
  isFunction: boolean;       // false for mainImage/global
  loops: DebugLoopInfo[];    // loops whose body contains the debug line
}
