import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';
import { GlslParser } from '../GlslParser';
import { VariableCaptureBuilder } from '../VariableCaptureBuilder';

/**
 * Tests for shaders where the opening brace is on a separate line from
 * the function signature, and multi-line return statements.
 */

const SHADER_BRACE_NEXT_LINE = `float sdBoxFrame( vec3 p, vec3 b, float e )
{
       p = abs(p  )-b;
  vec3 q = abs(p+e)-e;
  return min(min(
      length(max(vec3(p.x,q.y,q.z),0.0))+min(max(p.x,max(q.y,q.z)),0.0),
      length(max(vec3(q.x,p.y,q.z),0.0))+min(max(q.x,max(p.y,q.z)),0.0)),
      length(max(vec3(q.x,q.y,p.z),0.0))+min(max(q.x,max(q.y,p.z)),0.0));
}

float sdBox( vec3 p, vec3 b )
{
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}`;

const lines = SHADER_BRACE_NEXT_LINE.split('\n');

function findLine(content: string): number {
  const idx = lines.findIndex(l => l.includes(content));
  if (idx === -1) throw new Error(`Line not found: ${content}`);
  return idx;
}

describe('Brace-on-next-line - findEnclosingFunction', () => {
  it('should find sdBoxFrame when brace is on next line', () => {
    const returnLine = findLine('return min(min(');
    const funcInfo = GlslParser.findEnclosingFunction(lines, returnLine);
    expect(funcInfo.name).toBe('sdBoxFrame');
    expect(funcInfo.start).toBe(0);
  });

  it('should find sdBox when brace is on next line', () => {
    const returnLine = findLine('return length(max(q,0.0))');
    const funcInfo = GlslParser.findEnclosingFunction(lines, returnLine);
    expect(funcInfo.name).toBe('sdBox');
  });
});

describe('Brace-on-next-line - buildVariableTypeMap', () => {
  it('should include params p, b, e and local q for sdBoxFrame', () => {
    const returnLine = findLine('return min(min(');
    const funcInfo = GlslParser.findEnclosingFunction(lines, returnLine);
    const varTypes = GlslParser.buildVariableTypeMap(lines, returnLine, funcInfo);
    expect(varTypes.get('p')).toBe('vec3');
    expect(varTypes.get('b')).toBe('vec3');
    expect(varTypes.get('e')).toBe('float');
    expect(varTypes.get('q')).toBe('vec3');
  });

  it('should include params p, b and local q for sdBox', () => {
    const returnLine = findLine('return length(max(q,0.0))');
    const funcInfo = GlslParser.findEnclosingFunction(lines, returnLine);
    const varTypes = GlslParser.buildVariableTypeMap(lines, returnLine, funcInfo);
    expect(varTypes.get('p')).toBe('vec3');
    expect(varTypes.get('b')).toBe('vec3');
    expect(varTypes.get('q')).toBe('vec3');
    // Should NOT have sdBoxFrame vars
    expect(varTypes.has('e')).toBe(false);
  });
});

describe('Brace-on-next-line - getAllInScopeVariables on return lines', () => {
  it('sdBoxFrame multi-line return should show p, b, e, q, and _dbgReturn', () => {
    const line = findLine('return min(min(');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, line);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('b');
    expect(names).toContain('e');
    expect(names).toContain('q');
    expect(names).toContain('_dbgReturn');
    const dbgReturn = vars.find(v => v.varName === '_dbgReturn');
    expect(dbgReturn?.varType).toBe('float');
  });

  it('sdBoxFrame continuation line should also show _dbgReturn', () => {
    const line = findLine('length(max(vec3(p.x,q.y,q.z)');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, line);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('b');
    expect(names).toContain('e');
    expect(names).toContain('q');
    expect(names).toContain('_dbgReturn');
  });

  it('sdBox single-line return should show p, b, q, and _dbgReturn', () => {
    const line = findLine('return length(max(q,0.0))');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, line);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('b');
    expect(names).toContain('q');
    expect(names).toContain('_dbgReturn');
    // No leaks from sdBoxFrame
    expect(names).not.toContain('e');
  });
});

describe('Brace-on-next-line - modifyShaderForDebugging', () => {
  it('sdBoxFrame multi-line return should produce valid debug shader', () => {
    const line = findLine('return min(min(');
    const result = ShaderDebugger.modifyShaderForDebugging(
      SHADER_BRACE_NEXT_LINE, line, lines[line]
    );
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
    expect(result).toContain('void mainImage');
  });

  it('sdBoxFrame continuation line should produce valid debug shader', () => {
    const line = findLine('length(max(vec3(p.x,q.y,q.z)');
    const result = ShaderDebugger.modifyShaderForDebugging(
      SHADER_BRACE_NEXT_LINE, line, lines[line]
    );
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
  });

  it('sdBox return should produce valid debug shader', () => {
    const line = findLine('return length(max(q,0.0))');
    const result = ShaderDebugger.modifyShaderForDebugging(
      SHADER_BRACE_NEXT_LINE, line, lines[line]
    );
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
  });

  it('sdBoxFrame p reassignment should work', () => {
    const line = findLine('p = abs(p  )-b');
    const result = ShaderDebugger.modifyShaderForDebugging(
      SHADER_BRACE_NEXT_LINE, line, lines[line]
    );
    expect(result).not.toBeNull();
    // p should be detected as vec3 reassignment
    expect(result).toContain('result');
    expect(result).toContain('void mainImage');
  });

  it('sdBoxFrame vec3 q declaration should work', () => {
    const line = findLine('vec3 q = abs(p+e)-e');
    const result = ShaderDebugger.modifyShaderForDebugging(
      SHADER_BRACE_NEXT_LINE, line, lines[line]
    );
    expect(result).not.toBeNull();
    expect(result).toContain('result');
  });
});

describe('Brace-on-next-line - selector capture for _dbgReturn', () => {
  it('should generate selector capture for _dbgReturn on sdBoxFrame multi-line return', () => {
    const line = findLine('return min(min(');
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      SHADER_BRACE_NEXT_LINE,
      line,
      [{ varName: '_dbgReturn', varType: 'float', declarationLine: line }],
      new Map(),
      new Map(),
      false,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('uniform int _dbgVarIndex;');
    expect(result).toContain('_dbgCaptured0 = min(min(');
    expect(result).toContain('_dbg_sdBoxFrame');
  });

  it('should generate selector capture for _dbgReturn on sdBox return', () => {
    const line = findLine('return length(max(q,0.0))');
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      SHADER_BRACE_NEXT_LINE,
      line,
      [{ varName: '_dbgReturn', varType: 'float', declarationLine: line }],
      new Map(),
      new Map(),
      false,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgCaptured0 = length(max(q,0.0))');
    expect(result).toContain('_dbg_sdBox');
  });

  it('should generate selector capture for regular var p on sdBoxFrame return', () => {
    const line = findLine('return min(min(');
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      SHADER_BRACE_NEXT_LINE,
      line,
      [{ varName: 'p', varType: 'vec3', declarationLine: 1 }],
      new Map(),
      new Map(),
      false,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgCaptured0 = p;');
    expect(result).toContain('fragColor = vec4(_dbgCaptured0, 0.0);');
  });

  it('should generate selector capture for regular var q on sdBoxFrame return', () => {
    const line = findLine('return min(min(');
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      SHADER_BRACE_NEXT_LINE,
      line,
      [{ varName: 'q', varType: 'vec3', declarationLine: findLine('vec3 q = abs(p+e)-e') }],
      new Map(),
      new Map(),
      false,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgCaptured0 = q;');
    expect(result).toContain('fragColor = vec4(_dbgCaptured0, 0.0);');
  });
});

describe('Brace-on-next-line - ALL vars capturable on return lines', () => {
  it('sdBox return: capture shader succeeds for every in-scope variable', () => {
    const line = findLine('return length(max(q,0.0))');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, line);
    const names = vars.map(v => v.varName);
    // Verify all expected vars are present
    expect(names).toContain('p');
    expect(names).toContain('b');
    expect(names).toContain('q');
    expect(names).toContain('_dbgReturn');

    const shader = VariableCaptureBuilder.generateMultiCaptureShader(
      SHADER_BRACE_NEXT_LINE, line, vars, new Map(), new Map(), false
    );
    expect(shader).not.toBeNull();
    for (const [index, v] of vars.entries()) {
      expect(shader, `selector capture for '${v.varName}' should include index ${index}`)
        .toContain(`if (_dbgVarIndex == ${index})`);
    }
  });

  it('sdBoxFrame multi-line return: capture shader succeeds for every in-scope variable', () => {
    const line = findLine('return min(min(');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, line);
    const names = vars.map(v => v.varName);
    // Verify all expected vars are present
    expect(names).toContain('p');
    expect(names).toContain('b');
    expect(names).toContain('e');
    expect(names).toContain('q');
    expect(names).toContain('_dbgReturn');

    const shader = VariableCaptureBuilder.generateMultiCaptureShader(
      SHADER_BRACE_NEXT_LINE, line, vars, new Map(), new Map(), false
    );
    expect(shader).not.toBeNull();
    for (const [index, v] of vars.entries()) {
      expect(shader, `selector capture for '${v.varName}' should include index ${index}`)
        .toContain(`if (_dbgVarIndex == ${index})`);
    }
  });

  it('sdBoxFrame continuation line: capture shader succeeds for every in-scope variable', () => {
    const line = findLine('length(max(vec3(p.x,q.y,q.z)');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, line);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('q');
    expect(names).toContain('_dbgReturn');

    const shader = VariableCaptureBuilder.generateMultiCaptureShader(
      SHADER_BRACE_NEXT_LINE, line, vars, new Map(), new Map(), false
    );
    expect(shader).not.toBeNull();
  });
});

describe('Closing brace of function - modifyShaderForDebugging', () => {
  it('sdBoxFrame closing brace should produce valid debug shader', () => {
    const line = findLine('}'); // First } is sdBoxFrame's closing brace (line 8)
    const result = ShaderDebugger.modifyShaderForDebugging(
      SHADER_BRACE_NEXT_LINE, line, lines[line]
    );
    expect(result).not.toBeNull();
    expect(result).toContain('void mainImage');
  });

  it('sdBox closing brace should produce valid debug shader', () => {
    const sdBoxStart = findLine('float sdBox( vec3 p, vec3 b )');
    const closingBrace = lines.findIndex((l, i) => i > sdBoxStart && l.trim() === '}');
    expect(closingBrace).toBeGreaterThan(sdBoxStart);
    const result = ShaderDebugger.modifyShaderForDebugging(
      SHADER_BRACE_NEXT_LINE, closingBrace, lines[closingBrace]
    );
    expect(result).not.toBeNull();
    expect(result).toContain('void mainImage');
  });
});

describe('Closing brace of function - getAllInScopeVariables', () => {
  it('sdBoxFrame closing brace should show all in-scope vars', () => {
    const start = findLine('float sdBoxFrame');
    const closingBrace = lines.findIndex((l, i) => i > start && l.trim() === '}');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, closingBrace);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('b');
    expect(names).toContain('e');
    expect(names).toContain('q');
  });

  it('sdBox closing brace should show p, b, q but not e', () => {
    const sdBoxStart = findLine('float sdBox( vec3 p, vec3 b )');
    const closingBrace = lines.findIndex((l, i) => i > sdBoxStart && l.trim() === '}');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, closingBrace);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('b');
    expect(names).toContain('q');
    expect(names).not.toContain('e');
  });

  it('mainImage closing brace should show uv and fragColor (fragColor last)', () => {
    const lastLine = lines.length - 1; // closing } of mainImage
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, lastLine);
    const names = vars.map(v => v.varName);
    expect(names).toContain('uv');
    expect(names).toContain('fragColor');
    const fc = vars.find(v => v.varName === 'fragColor');
    expect(fc?.varType).toBe('vec4');
    // fragColor should always be last
    expect(names[names.length - 1]).toBe('fragColor');
  });
});

describe('Closing brace of function - selector capture shader', () => {
  it('sdBox closing brace: selector capture succeeds for every in-scope var', () => {
    const sdBoxStart = findLine('float sdBox( vec3 p, vec3 b )');
    const closingBrace = lines.findIndex((l, i) => i > sdBoxStart && l.trim() === '}');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, closingBrace);
    expect(vars.length).toBeGreaterThan(0);
    const shader = VariableCaptureBuilder.generateMultiCaptureShader(
      SHADER_BRACE_NEXT_LINE, closingBrace, vars, new Map(), new Map(), false
    );
    expect(shader).not.toBeNull();
  });

  it('sdBoxFrame closing brace: selector capture succeeds for every in-scope var', () => {
    const start = findLine('float sdBoxFrame');
    const closingBrace = lines.findIndex((l, i) => i > start && l.trim() === '}');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, closingBrace);
    expect(vars.length).toBeGreaterThan(0);
    const shader = VariableCaptureBuilder.generateMultiCaptureShader(
      SHADER_BRACE_NEXT_LINE, closingBrace, vars, new Map(), new Map(), false
    );
    expect(shader).not.toBeNull();
  });
});

describe('declarationLine - closest occurrence above debug line', () => {
  it('p after reassignment should point to reassignment line, not param', () => {
    // p = abs(p)-b is a reassignment; when on q line, p should point there
    const line = findLine('vec3 q = abs(p+e)-e');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, line);
    const p = vars.find(v => v.varName === 'p');
    const reassignLine = findLine('p = abs(p  )-b');
    expect(p?.declarationLine).toBe(reassignLine);
  });

  it('b and e with no reassignment should point to function signature', () => {
    const line = findLine('vec3 q = abs(p+e)-e');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, line);
    const sigLine = findLine('float sdBoxFrame');
    const b = vars.find(v => v.varName === 'b');
    const e = vars.find(v => v.varName === 'e');
    expect(b?.declarationLine).toBe(sigLine);
    expect(e?.declarationLine).toBe(sigLine);
  });

  it('p before reassignment should point to param line', () => {
    // On the p = abs(p)-b line itself, p should point to that line (same line counts)
    const line = findLine('p = abs(p  )-b');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, line);
    const p = vars.find(v => v.varName === 'p');
    expect(p?.declarationLine).toBe(line);
  });

  it('sdBoxFrame local q should point to its declaration line', () => {
    const returnLine = findLine('return min(min(');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, returnLine);
    const q = vars.find(v => v.varName === 'q');
    const qLine = findLine('vec3 q = abs(p+e)-e');
    expect(q?.declarationLine).toBe(qLine);
  });

  it('sdBox local q should point to sdBox declaration, not sdBoxFrame', () => {
    const line = findLine('return length(max(q,0.0))');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, line);
    const q = vars.find(v => v.varName === 'q');
    const qLine = findLine('vec3 q = abs(p) - b');
    expect(q?.declarationLine).toBe(qLine);
  });

  it('_dbgReturn should point to the return line', () => {
    const returnLine = findLine('return length(max(q,0.0))');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, returnLine);
    const dbgReturn = vars.find(v => v.varName === '_dbgReturn');
    expect(dbgReturn?.declarationLine).toBe(returnLine);
  });

  it('mainImage fragColor should point to assignment line and be last', () => {
    const lastLine = lines.length - 1;
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, lastLine);
    const fc = vars.find(v => v.varName === 'fragColor');
    expect(fc).toBeDefined();
    expect(fc!.declarationLine).toBe(findLine('fragColor = vec4'));
    expect(vars[vars.length - 1].varName).toBe('fragColor');
  });

  it('mainImage uv should point to its declaration line', () => {
    const lastLine = lines.length - 1;
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER_BRACE_NEXT_LINE, lastLine);
    const uv = vars.find(v => v.varName === 'uv');
    expect(uv?.declarationLine).toBe(findLine('vec2 uv'));
  });
});
