export type ParameterMode = 'expression';

/**
 * Shader source dialect. 'glsl' is the ShaderToy WebGL convention
 * (void mainImage(out vec4 fragColor, in vec2 fragCoord)); 'slang' is the
 * WebGPU convention (float4 mainImage(float2 fragCoord) returning the color).
 */
export type ShaderDialect = 'glsl' | 'slang';

export interface ShaderDebugDiagnostic {
  code: 'slang-cross-file-debug-unsupported';
  severity: 'error';
  message: string;
  source: 'slang-compile';
  sourceUri: string;
  passName: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

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
