import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';
import { GlslParser } from '../GlslParser';
import { VariableCaptureBuilder } from '../VariableCaptureBuilder';

/**
 * Tests that every debuggable line in a complex multi-function raymarching shader
 * works correctly with line debugging and variable capture.
 *
 * Key concerns:
 * - Variables from other functions should NOT leak into scope
 * - Multi-line statements should be handled correctly
 * - Return lines should have all preceding variables in scope
 * - Loop variables, shadow variables, and control flow should work
 */

const SHADER = `#define MAX_STEPS 100
#define MAX_DIST 200.0
#define SURFACE_DIST .005

float sdBox(vec3 p, float b) {
    return max(max(abs(p.x), abs(p.y)), abs(p.z)) - b;
}

float sdBoxFrame( vec3 p, vec3 b, float e ) {
       p = abs(p  )-b + 0.2;
  vec3 q = abs(p+e)-e;
  return min(min(
      length(max(vec3(p.x,q.y,q.z),0.0))+min(max(p.x,max(q.y,q.z)),0.0),
      length(max(vec3(q.x,p.y,q.z),0.0))+min(max(q.x,max(p.y,q.z)),0.0)),
      length(max(vec3(q.x,q.y,p.z),0.0))+min(max(q.x,max(q.y,p.z)),0.0));
}

float sdBox( vec3 p, vec3 b ) {
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}

float getDist(vec3 p) {
    //  made e bigger for visibility    return d;
    if (mod(p.x, 4.0) < 3.0) {
        return min(sdBoxFrame(fract(p) - 0.5, vec3(0.5), 0.02), sdBox(fract(p) - 0.5, 0.1));
    } else {
        return 0.0;
    }
}

vec4 rayMarch(vec3 ro, vec3 rd) {
    float d = 0.0;
    vec3 col = vec3(0.0);
    float alpha = 0.0;
    float boxAlpha = 0.5; // per-hit opacity, tweak for denser/thinner effect

    for (int i = 0; i < MAX_STEPS; ++i) {
        if (d > MAX_DIST || alpha > 0.98) break;
        vec3 p = ro + d * rd;
        float dist = getDist(p);

        if (dist < SURFACE_DIST) {
            // Color by cell position for fun
            vec3 cell = floor(p);
            vec3 boxColor = 0.5 + 0.5 * sin(cell * 2.1 + vec3(0.0, 2.0, 4.0)); // palette
            // Alpha blend
            col = mix(col, boxColor, boxAlpha * (1.0 - alpha));
            alpha += boxAlpha * (1.0 - alpha);
            d += 0.03; // skip ahead a bit so we don't stick in the same box
        } else {
            d += max(dist, 0.01); // always march at least a bit to avoid infinite loop
        }
    }
    // Blend with background (black)
    col = mix(vec3(0.05), col, alpha);
    return vec4(col, 1.0);
}

vec3 calcDirection(vec2 uv) {
    vec3 ypr = texelFetch(iChannel0, ivec2(1, 0), 0).xyz; // yaw, pitch, roll
    float yaw = ypr.x;
    float pitch = ypr.y;
    float roll = ypr.z;

    vec3 forward = normalize(vec3(
        cos(pitch) * sin(yaw),
        sin(pitch),
        cos(pitch) * cos(yaw)
    ));

    // Choose a world up that is **not parallel** to forward
    vec3 worldUp = abs(forward.y) > 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);

    vec3 right = normalize(cross(worldUp, forward));
    vec3 up = cross(forward, right);

    float cosR = cos(roll);
    float sinR = sin(roll);

    vec3 rolledRight = right * cosR - up * sinR;
    vec3 rolledUp    = right * sinR + up * cosR;

    return normalize(forward + uv.x * rolledRight + uv.y * rolledUp);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = (gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y;

    vec3 direction = vec3(0.0);

    vec3 ro = texelFetch(iChannel0, ivec2(0, 0), 0).xyz; // camera, ray origin
    vec3 rd = calcDirection(uv);

    vec4 col = rayMarch(ro + vec3(0.5), rd);

    fragColor = col;
}`;

const lines = SHADER.split('\n');

// Helper to find line number by content
function findLine(content: string): number {
  const idx = lines.findIndex(l => l.includes(content));
  if (idx === -1) throw new Error(`Line not found: ${content}`);
  return idx;
}

// For helper functions, the debugger wraps them and visualizes via 'result' in a
// generated mainImage. For mainImage itself, the variable is visualized directly.
function expectHelperDebug(result: string | null, varName: string) {
  expect(result).not.toBeNull();
  // The truncated function should contain the variable
  expect(result!).toContain(varName);
  // A wrapper mainImage is generated that calls the function
  expect(result!).toContain('void mainImage');
  expect(result!).toContain('result');
}

describe('Raymarcher shader - modifyShaderForDebugging', () => {
  // --- sdBox (first overload) ---
  it('should debug return in sdBox(vec3, float)', () => {
    const line = findLine('return max(max(abs(p.x)');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
  });

  // --- sdBoxFrame ---
  it('should debug reassignment p = abs(p) in sdBoxFrame', () => {
    const line = findLine('p = abs(p  )-b + 0.2');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'p');
    expect(result).toContain('float sdBoxFrame( vec3 p, vec3 b, float e ) {');
    expect(result).toContain('vec3 _dbg_sdBoxFrame( vec3 p, vec3 b, float e ) {');
    expect(result).toContain('return min(sdBoxFrame(fract(p) - 0.5, vec3(0.5), 0.02), sdBox(fract(p) - 0.5, 0.1));');
    expect(result).toContain('vec3 result = _dbg_sdBoxFrame(vec3(0.5), vec3(0.5), 0.5);');
  });

  it('should debug vec3 q declaration in sdBoxFrame', () => {
    const line = findLine('vec3 q = abs(p+e)-e');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'q');
  });

  it('should debug multi-line return in sdBoxFrame', () => {
    const line = findLine('return min(min(');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
  });

  it('should debug continuation line of multi-line return in sdBoxFrame', () => {
    const line = findLine('length(max(vec3(p.x,q.y,q.z)');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
  });

  // --- sdBox (second overload) ---
  it('should debug vec3 q declaration in second sdBox overload', () => {
    const line = findLine('vec3 q = abs(p) - b;');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'q');
  });

  it('should debug return in second sdBox overload', () => {
    const line = findLine('return length(max(q,0.0))');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
  });

  // --- getDist ---
  it('should handle comment-only line in getDist (full function fallback)', () => {
    const line = findLine('//  made e bigger for visibility');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    // No variable on this line, but getDist returns float → full function execution
    expect(result).not.toBeNull();
    expect(result).toContain('getDist');
  });

  it('should debug return inside if-block in getDist', () => {
    const line = findLine('return min(sdBoxFrame');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
  });

  it('should debug return 0.0 inside else-block in getDist', () => {
    const line = findLine('return 0.0;');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
  });

  // --- rayMarch (helper function, NOT mainImage) ---
  it('should debug float d declaration in rayMarch', () => {
    const line = findLine('float d = 0.0;');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'd');
  });

  it('should debug vec3 col declaration in rayMarch', () => {
    const line = findLine('vec3 col = vec3(0.0);');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'col');
  });

  it('should debug float alpha declaration in rayMarch', () => {
    const line = findLine('float alpha = 0.0;');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'alpha');
  });

  it('should debug float boxAlpha declaration in rayMarch', () => {
    const line = findLine('float boxAlpha = 0.5');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'boxAlpha');
  });

  it('should debug vec3 p inside loop in rayMarch', () => {
    const line = findLine('vec3 p = ro + d * rd;');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    // Inside a loop — should have shadow variable
    expect(result).toContain('_dbgShadow');
  });

  it('should debug float dist inside loop in rayMarch', () => {
    const line = findLine('float dist = getDist(p);');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgShadow');
  });

  it('should debug vec3 cell inside loop+if in rayMarch', () => {
    const line = findLine('vec3 cell = floor(p);');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgShadow');
  });

  it('should debug vec3 boxColor inside loop+if in rayMarch', () => {
    const line = findLine('vec3 boxColor = 0.5 + 0.5 * sin');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgShadow');
  });

  it('should debug col reassignment inside loop+if in rayMarch', () => {
    const line = findLine('col = mix(col, boxColor');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgShadow');
  });

  it('should debug alpha += inside loop+if in rayMarch', () => {
    const line = findLine('alpha += boxAlpha * (1.0 - alpha)');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgShadow');
  });

  it('should debug d += 0.03 inside loop+if in rayMarch', () => {
    const line = findLine('d += 0.03');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgShadow');
  });

  it('should debug d += max(dist, 0.01) inside loop+else in rayMarch', () => {
    const line = findLine('d += max(dist, 0.01)');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgShadow');
  });

  it('should debug col = mix after loop in rayMarch', () => {
    const line = findLine('col = mix(vec3(0.05), col, alpha)');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'col');
  });

  it('should debug return in rayMarch', () => {
    const line = findLine('return vec4(col, 1.0);');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
  });

  // --- calcDirection (helper function) ---
  it('should debug vec3 ypr with texelFetch in calcDirection', () => {
    const line = findLine('vec3 ypr = texelFetch');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'ypr');
  });

  it('should debug float yaw in calcDirection', () => {
    const line = findLine('float yaw = ypr.x');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'yaw');
  });

  it('should debug multi-line vec3 forward declaration in calcDirection', () => {
    const line = findLine('vec3 forward = normalize(vec3(');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'forward');
  });

  it('should debug continuation of multi-line forward (cos line) in calcDirection', () => {
    const line = findLine('cos(pitch) * sin(yaw),');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    // Multi-line detection should reconstruct the full vec3 forward = ... statement
    expect(result).toContain('forward');
  });

  it('should debug vec3 worldUp ternary in calcDirection', () => {
    const line = findLine('vec3 worldUp = abs(forward.y)');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'worldUp');
  });

  it('should debug vec3 right in calcDirection', () => {
    const line = findLine('vec3 right = normalize(cross');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'right');
  });

  it('should debug vec3 up in calcDirection', () => {
    const line = findLine('vec3 up = cross(forward, right)');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'up');
  });

  it('should debug float cosR in calcDirection', () => {
    const line = findLine('float cosR = cos(roll)');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'cosR');
  });

  it('should debug float sinR in calcDirection', () => {
    const line = findLine('float sinR = sin(roll)');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'sinR');
  });

  it('should debug vec3 rolledRight in calcDirection', () => {
    const line = findLine('vec3 rolledRight = right * cosR');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'rolledRight');
  });

  it('should debug vec3 rolledUp in calcDirection', () => {
    const line = findLine('vec3 rolledUp');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expectHelperDebug(result, 'rolledUp');
  });

  it('should debug return in calcDirection', () => {
    const line = findLine('return normalize(forward + uv.x');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
  });

  // --- mainImage (visualization uses variable name directly) ---
  it('should debug vec2 uv in mainImage', () => {
    const line = findLine('vec2 uv = (gl_FragCoord');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('vec4(uv, 0.0, 1.0)');
  });

  it('should debug vec3 direction in mainImage', () => {
    const line = findLine('vec3 direction = vec3(0.0)');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('vec4(direction, 1.0)');
  });

  it('should debug vec3 ro in mainImage', () => {
    const line = findLine('vec3 ro = texelFetch(iChannel0, ivec2(0, 0)');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('vec4(ro, 1.0)');
  });

  it('should debug vec3 rd in mainImage', () => {
    const line = findLine('vec3 rd = calcDirection');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('vec4(rd, 1.0)');
  });

  it('should debug vec4 col in mainImage', () => {
    const line = findLine('vec4 col = rayMarch');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('fragColor = col');
  });

  it('should debug fragColor = col in mainImage', () => {
    const line = findLine('fragColor = col;');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, line, lines[line]);
    expect(result).not.toBeNull();
    expect(result).toContain('fragColor');
  });
});

describe('Raymarcher shader - getAllInScopeVariables (no cross-function leaks)', () => {
  it('should have params + _dbgReturn at sdBox return', () => {
    const line = findLine('return max(max(abs(p.x)');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, line);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('b');
    expect(names).toContain('_dbgReturn');
    expect(names).toHaveLength(3);
  });

  it('should have params + q + _dbgReturn at sdBoxFrame return', () => {
    const line = findLine('return min(min(');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, line);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('b');
    expect(names).toContain('e');
    expect(names).toContain('q');
    expect(names).toContain('_dbgReturn');
    expect(names).toHaveLength(5);
  });

  it('should have params + q + _dbgReturn at second sdBox return, no leak from sdBoxFrame', () => {
    const line = findLine('return length(max(q,0.0))');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, line);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('b');
    expect(names).toContain('q');
    expect(names).toContain('_dbgReturn');
    // Should NOT contain variables from sdBoxFrame (e)
    expect(names).not.toContain('e');
  });

  it('should have param p + _dbgReturn at getDist return, no leak from prior functions', () => {
    const line = findLine('return min(sdBoxFrame');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, line);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('_dbgReturn');
    // Should NOT contain q from sdBoxFrame/sdBox
    expect(names).not.toContain('q');
    // Should NOT contain b from sdBox
    expect(names).not.toContain('b');
  });

  it('should have rayMarch body vars + _dbgReturn at return, no leak from prior functions', () => {
    const line = findLine('return vec4(col, 1.0);');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, line);
    const names = vars.map(v => v.varName);
    // Should contain params and body declarations
    expect(names).toContain('ro');
    expect(names).toContain('rd');
    expect(names).toContain('d');
    expect(names).toContain('col');
    expect(names).toContain('alpha');
    expect(names).toContain('boxAlpha');
    // Return value should be capturable
    expect(names).toContain('_dbgReturn');
    const dbgReturn = vars.find(v => v.varName === '_dbgReturn');
    expect(dbgReturn?.varType).toBe('vec4');
    // Should NOT contain variables from sdBoxFrame, sdBox, getDist
    expect(names).not.toContain('q');
    expect(names).not.toContain('b');
    expect(names).not.toContain('e');
  });

  it('should have all calcDirection vars + _dbgReturn at return, no leak from prior functions', () => {
    const line = findLine('return normalize(forward + uv.x');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, line);
    const names = vars.map(v => v.varName);
    // Should contain param and all local declarations
    expect(names).toContain('uv');
    expect(names).toContain('ypr');
    expect(names).toContain('yaw');
    expect(names).toContain('pitch');
    expect(names).toContain('roll');
    expect(names).toContain('forward');
    expect(names).toContain('worldUp');
    expect(names).toContain('right');
    expect(names).toContain('up');
    expect(names).toContain('cosR');
    expect(names).toContain('sinR');
    expect(names).toContain('rolledRight');
    expect(names).toContain('rolledUp');
    // Return value should be capturable
    expect(names).toContain('_dbgReturn');
    const dbgReturn = vars.find(v => v.varName === '_dbgReturn');
    expect(dbgReturn?.varType).toBe('vec3');
    // Should NOT contain variables from other functions
    expect(names).not.toContain('q');
    expect(names).not.toContain('d');
    expect(names).not.toContain('col');
    expect(names).not.toContain('alpha');
    expect(names).not.toContain('ro');
    expect(names).not.toContain('rd');
  });

  it('should have mainImage body vars at fragColor line, no leak from prior functions', () => {
    const line = findLine('fragColor = col;');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, line);
    const names = vars.map(v => v.varName);
    // fragCoord is an in param, should be included
    expect(names).toContain('fragCoord');
    expect(names).toContain('uv');
    expect(names).toContain('direction');
    expect(names).toContain('ro');
    expect(names).toContain('rd');
    expect(names).toContain('col');
    // fragColor is visible in mainImage (it's the shader output) and always last
    expect(names).toContain('fragColor');
    expect(names[names.length - 1]).toBe('fragColor');
    // Should NOT contain variables from other functions
    expect(names).not.toContain('q');
    expect(names).not.toContain('d');
    expect(names).not.toContain('alpha');
    expect(names).not.toContain('yaw');
    expect(names).not.toContain('forward');
  });
});

describe('Raymarcher shader - buildVariableTypeMap scoping', () => {
  it('should not leak sdBoxFrame vars into second sdBox', () => {
    const secondSdBoxLine = findLine('vec3 q = abs(p) - b;');
    const funcInfo = GlslParser.findEnclosingFunction(lines, secondSdBoxLine);
    expect(funcInfo.name).toBe('sdBox');
    const varTypes = GlslParser.buildVariableTypeMap(lines, secondSdBoxLine, funcInfo);
    // Should have params p (vec3), b (vec3) and declaration q (vec3)
    expect(varTypes.get('p')).toBe('vec3');
    expect(varTypes.get('b')).toBe('vec3');
    expect(varTypes.get('q')).toBe('vec3');
    // Should NOT have 'e' from sdBoxFrame
    expect(varTypes.has('e')).toBe(false);
  });

  it('should not leak prior function vars into rayMarch', () => {
    const returnLine = findLine('return vec4(col, 1.0);');
    const funcInfo = GlslParser.findEnclosingFunction(lines, returnLine);
    expect(funcInfo.name).toBe('rayMarch');
    const varTypes = GlslParser.buildVariableTypeMap(lines, returnLine, funcInfo);
    // Should have rayMarch params and local vars
    expect(varTypes.get('ro')).toBe('vec3');
    expect(varTypes.get('rd')).toBe('vec3');
    expect(varTypes.get('d')).toBe('float');
    expect(varTypes.get('col')).toBe('vec3');
    // Should NOT have vars from sdBoxFrame, sdBox, getDist
    expect(varTypes.has('e')).toBe(false);
    // q is only declared in sdBoxFrame and sdBox, not in rayMarch
    expect(varTypes.has('q')).toBe(false);
  });

  it('should not leak prior function vars into calcDirection', () => {
    const returnLine = findLine('return normalize(forward + uv.x');
    const funcInfo = GlslParser.findEnclosingFunction(lines, returnLine);
    expect(funcInfo.name).toBe('calcDirection');
    const varTypes = GlslParser.buildVariableTypeMap(lines, returnLine, funcInfo);
    expect(varTypes.get('uv')).toBe('vec2');
    expect(varTypes.get('forward')).toBe('vec3');
    expect(varTypes.get('cosR')).toBe('float');
    // Should NOT have vars from any prior function
    expect(varTypes.has('q')).toBe(false);
    expect(varTypes.has('d')).toBe(false);
    expect(varTypes.has('col')).toBe(false);
    expect(varTypes.has('alpha')).toBe(false);
    expect(varTypes.has('ro')).toBe(false);
    expect(varTypes.has('e')).toBe(false);
  });
});

describe('Raymarcher shader - _dbgReturn capture shader', () => {
  it('should generate capture shader for _dbgReturn on sdBox return line', () => {
    const line = findLine('return max(max(abs(p.x)');
    const result = VariableCaptureBuilder.generateCaptureShader(
      SHADER, line, '_dbgReturn', 'float', new Map(), new Map(), false
    );
    expect(result).not.toBeNull();
    // Function body should have _dbgReturn assignment (converted from return)
    expect(result).toContain('_dbgReturn');
    // Wrapper mainImage captures via 'result' variable
    expect(result).toContain('float result = _dbg_sdBox');
    expect(result).toContain('fragColor = vec4(result, 0.0, 0.0, 0.0);');
  });

  it('should generate capture shader for _dbgReturn on rayMarch return line', () => {
    const line = findLine('return vec4(col, 1.0);');
    const result = VariableCaptureBuilder.generateCaptureShader(
      SHADER, line, '_dbgReturn', 'vec4', new Map(), new Map(), false
    );
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
    expect(result).toContain('vec4 result = _dbg_rayMarch');
    expect(result).toContain('fragColor = result;');
  });

  it('should generate capture shader for _dbgReturn on calcDirection return line', () => {
    const line = findLine('return normalize(forward + uv.x');
    const result = VariableCaptureBuilder.generateCaptureShader(
      SHADER, line, '_dbgReturn', 'vec3', new Map(), new Map(), false
    );
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
    expect(result).toContain('vec3 result = _dbg_calcDirection');
    expect(result).toContain('fragColor = vec4(result, 0.0);');
  });

  it('should generate capture shader for _dbgReturn on getDist return inside if', () => {
    const line = findLine('return min(sdBoxFrame');
    const result = VariableCaptureBuilder.generateCaptureShader(
      SHADER, line, '_dbgReturn', 'float', new Map(), new Map(), false
    );
    expect(result).not.toBeNull();
    expect(result).toContain('_dbgReturn');
  });

  it('should not include _dbgReturn on non-return lines', () => {
    const line = findLine('float d = 0.0;');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, line);
    const names = vars.map(v => v.varName);
    expect(names).not.toContain('_dbgReturn');
  });
});

describe('Raymarcher shader - cursor from below function to return line', () => {
  it('should find correct function when cursor moves from after function to return line', () => {
    // Simulate cursor being on the return line of getDist
    // (as if cursor moved up from empty line after getDist's closing brace)
    const returnLine = findLine('return min(sdBoxFrame');
    const funcInfo = GlslParser.findEnclosingFunction(lines, returnLine);
    expect(funcInfo.name).toBe('getDist');
    expect(funcInfo.start).toBeGreaterThanOrEqual(0);

    // Variables should be correctly scoped
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, returnLine);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('_dbgReturn');
    expect(names).not.toContain('q');
  });

  it('should find correct function when cursor moves from after calcDirection to its return', () => {
    const returnLine = findLine('return normalize(forward + uv.x');
    const funcInfo = GlslParser.findEnclosingFunction(lines, returnLine);
    expect(funcInfo.name).toBe('calcDirection');

    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, returnLine);
    const names = vars.map(v => v.varName);
    expect(names).toContain('uv');
    expect(names).toContain('forward');
    expect(names).toContain('rolledUp');
    expect(names).toContain('_dbgReturn');
    // No leaks from rayMarch
    expect(names).not.toContain('ro');
    expect(names).not.toContain('col');
  });

  it('should return null for line between functions (global scope)', () => {
    // Empty line between getDist and rayMarch
    const getDistEnd = findLine('float getDist(vec3 p)');
    // Find closing brace of getDist
    const funcInfo = GlslParser.findEnclosingFunction(lines, getDistEnd + 1);
    const afterFunc = funcInfo.end + 1;
    if (lines[afterFunc]?.trim() === '') {
      const result = GlslParser.findEnclosingFunction(lines, afterFunc);
      expect(result.name).toBeNull();
    }
  });
});

describe('Raymarcher shader - closing brace of function', () => {
  it('sdBox closing brace should produce valid debug shader', () => {
    // sdBox: float sdBox(vec3 p, float b) { ... }
    const sdBoxStart = findLine('float sdBox(vec3 p, float b)');
    // Find its closing brace
    const closingBrace = lines.findIndex((l, i) => i > sdBoxStart && l.trim() === '}');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, closingBrace, lines[closingBrace]);
    expect(result).not.toBeNull();
    expect(result).toContain('void mainImage');
  });

  it('sdBoxFrame closing brace should produce valid debug shader', () => {
    const start = findLine('float sdBoxFrame');
    const closingBrace = lines.findIndex((l, i) => i > start && l.trim() === '}');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, closingBrace, lines[closingBrace]);
    expect(result).not.toBeNull();
    expect(result).toContain('void mainImage');
  });

  it('getDist closing brace should produce valid debug shader', () => {
    const start = findLine('float getDist');
    const closingBrace = lines.findIndex((l, i) => i > start && l.trim() === '}');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, closingBrace, lines[closingBrace]);
    expect(result).not.toBeNull();
    expect(result).toContain('void mainImage');
  });

  it('rayMarch closing brace should produce valid debug shader', () => {
    const start = findLine('vec4 rayMarch');
    const closingBrace = lines.findIndex((l, i) => i > start && l.trim() === '}');
    const result = ShaderDebugger.modifyShaderForDebugging(SHADER, closingBrace, lines[closingBrace]);
    expect(result).not.toBeNull();
    expect(result).toContain('void mainImage');
  });

  it('sdBox closing brace: getAllInScopeVariables shows p and b', () => {
    const start = findLine('float sdBox(vec3 p, float b)');
    const closingBrace = lines.findIndex((l, i) => i > start && l.trim() === '}');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, closingBrace);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('b');
  });

  it('sdBoxFrame closing brace: getAllInScopeVariables shows p, b, e, q', () => {
    const start = findLine('float sdBoxFrame');
    const closingBrace = lines.findIndex((l, i) => i > start && l.trim() === '}');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, closingBrace);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
    expect(names).toContain('b');
    expect(names).toContain('e');
    expect(names).toContain('q');
  });

  it('getDist closing brace: getAllInScopeVariables shows p', () => {
    const start = findLine('float getDist');
    const closingBrace = lines.findIndex((l, i) => i > start && l.trim() === '}');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, closingBrace);
    const names = vars.map(v => v.varName);
    expect(names).toContain('p');
  });

  it('closing brace: capture shader succeeds for all in-scope vars', () => {
    const start = findLine('float sdBoxFrame');
    const closingBrace = lines.findIndex((l, i) => i > start && l.trim() === '}');
    const vars = VariableCaptureBuilder.getAllInScopeVariables(SHADER, closingBrace);
    expect(vars.length).toBeGreaterThan(0);
    for (const v of vars) {
      const shader = VariableCaptureBuilder.generateCaptureShader(
        SHADER, closingBrace, v.varName, v.varType, new Map(), new Map(), false
      );
      expect(shader, `capture for '${v.varName}' should not be null`).not.toBeNull();
    }
  });
});

describe('Raymarcher shader - lines that should return null', () => {
  it('should return null for #define lines', () => {
    expect(ShaderDebugger.modifyShaderForDebugging(SHADER, 0, lines[0])).toBeNull();
    expect(ShaderDebugger.modifyShaderForDebugging(SHADER, 1, lines[1])).toBeNull();
    expect(ShaderDebugger.modifyShaderForDebugging(SHADER, 2, lines[2])).toBeNull();
  });

  it('should return null for empty lines in mainImage', () => {
    // Find an empty line inside mainImage
    const emptyLine = findLine('vec2 uv = (gl_FragCoord') + 1;
    if (lines[emptyLine].trim() === '') {
      const result = ShaderDebugger.modifyShaderForDebugging(SHADER, emptyLine, lines[emptyLine]);
      expect(result).toBeNull();
    }
  });
});
