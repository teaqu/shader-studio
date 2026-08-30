import { describe, expect, it } from 'vitest';
import { VariableCaptureBuilder, GlslParser } from '@shader-studio/debug';
import {
  firstUnterminatedStatementLine,
  truncateFunctionBodyAt,
  enclosingFunctionRange,
} from '@shader-studio/rendering';

/**
 * A capture must only ever report variables of the function being inspected.
 * Driving that through the real app is slow, so this sweeps every combination
 * of "break here, inspect there" over one shader and reports the ones that
 * break the rule - the same defect classes the e2e catches, in milliseconds.
 */
const SHADER = `#define SCALE 2.03

vec3 revcol(float r, float g, float b) {
    return vec3(1.0 - r, 1.0 - g, 1.0 - b);
}

float hash21(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    return mix(a, b, f.x);
}

float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;

    for (int i = 0; i < 3; i++) {
        float step = amp * noise(p);
        if (step > 0.25) {
            v += step;
        } else {
            v -= step;
        }
        p *= SCALE;
        amp *= 0.5;
    }

    return v;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = (fragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    vec3 rad = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));
    float sq = max(abs(uv.x), abs(uv.y));

    vec3 col = vec3(sq); // a comment with a brace } inside
    col *= rad;

    vec2 p = uv * 10.0;
    float n = fbm(p + vec2(0.0, iTime * 0.7));

    {
        float scoped = n * 2.0;
        col += scoped;
    }

    float edge = 2.0 - smoothstep(0.08, 0.22, abs(n - 0.52));
    vec4 tex = vec4(edge) * 0.08;

    fragColor = tex + vec4(col, 1.0);
}`;


/** Where each function starts and ends, 1-based and inclusive. */
function functionRanges(source: string): { name: string; start: number; end: number }[] {
  const lines = source.split('\n');
  const ranges: { name: string; start: number; end: number }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const enclosing = GlslParser.findEnclosingFunction(lines, index);
    if (!enclosing.name || enclosing.start < 0) {
      continue;
    }
    if (!ranges.some((range) => range.start === enclosing.start + 1)) {
      ranges.push({ name: enclosing.name, start: enclosing.start + 1, end: enclosing.end + 1 });
    }
  }
  return ranges;
}

/**
 * Names belonging to one function: its parameters and its body's declarations.
 * Parameters count, or a shared parameter name reads as another function's.
 */
function localsOf(source: string, range: { start: number; end: number }): Set<string> {
  const names = new Set<string>();
  const lines = source.split('\n').slice(range.start - 1, range.end);
  for (const parameter of lines[0]?.match(/\(([^)]*)\)/)?.[1]?.split(',') ?? []) {
    const name = parameter.trim().split(/\s+/).pop();
    if (name) {
      names.add(name);
    }
  }
  const declaration = /^\s*(?:\w[\w<>]*)\s+(\w+)\s*(?:=|;|\))/;
  // Loop variables are declarations too: `for (int i = 0; ...)`.
  const loopDeclaration = /\bfor\s*\(\s*\w[\w<>]*\s+(\w+)/;
  for (const line of lines.slice(1)) {
    for (const match of [line.match(declaration), line.match(loopDeclaration)]) {
      if (match) {
        names.add(match[1]);
      }
    }
  }
  return names;
}

/** What the capture pipeline resolves for a break at one line, inspected at another. */
function inspect(source: string, breakLine: number, inspectLine: number): string[] {
  const captureCode = truncateFunctionBodyAt(source, breakLine) ?? source;
  const broken = enclosingFunctionRange(source, breakLine);
  const insideBroken = broken !== null && inspectLine >= broken.start && inspectLine <= broken.end;
  const zeroBased = inspectLine - 1;
  const effective = insideBroken && zeroBased >= breakLine - 2 ? breakLine - 2 : zeroBased;
  return VariableCaptureBuilder.getAllInScopeVariables(captureCode, effective)
    .map((variable) => variable.varName);
}

describe('capture scope with a break anywhere in the shader', () => {
  const ranges = functionRanges(SHADER);
  const lines = SHADER.split('\n');

  it('keeps the cut source structurally sound for every break', () => {
    const failures: string[] = [];

    for (const broken of ranges) {
      for (let breakAfter = broken.start + 1; breakAfter < broken.end; breakAfter += 1) {
        const source = [...lines.slice(0, breakAfter), 'd', ...lines.slice(breakAfter)].join('\n');
        const detected = firstUnterminatedStatementLine(source);
        if (detected === null) {
          failures.push(`break after ${breakAfter}: not detected`);
          continue;
        }
        const cut = truncateFunctionBodyAt(source, detected);
        if (cut === null) {
          failures.push(`break@${detected}: nothing cut`);
          continue;
        }
        const cutLines = cut.split('\n');
        if (cutLines.length !== source.split('\n').length) {
          failures.push(`break@${detected}: line count changed`);
        }
        if (cutLines.some((line) => line.trim() === 'd')) {
          failures.push(`break@${detected}: the break survived the cut`);
        }
        // Braces inside comments are text, not structure.
        const code = cut.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
        const opens = (code.match(/\{/g) ?? []).length;
        const closes = (code.match(/\}/g) ?? []).length;
        if (opens !== closes) {
          failures.push(`break@${detected}: braces unbalanced (${opens} vs ${closes})`);
        }
      }
    }

    expect(failures.slice(0, 12).join('\n')).toBe('');
  });

  it('finds every function in the fixture', () => {
    expect(ranges.map((range) => range.name))
      .toEqual(['revcol', 'hash21', 'noise', 'fbm', 'mainImage']);
  });

  it('never reports another function\'s locals, for any break and any inspected line', () => {
    const failures: string[] = [];

    for (const broken of ranges) {
      // Put the break after each statement of this function in turn, starting
      // inside the body: between a signature and its brace is not a statement.
      for (let breakAfter = broken.start + 1; breakAfter < broken.end; breakAfter += 1) {
        const source = [
          ...lines.slice(0, breakAfter),
          'd',
          ...lines.slice(breakAfter),
        ].join('\n');

        const detected = firstUnterminatedStatementLine(source);
        if (detected !== breakAfter + 1) {
          failures.push(`break after ${breakAfter}: detected ${detected}`);
          continue;
        }

        for (const inspected of functionRanges(source)) {
          const foreign = functionRanges(source)
            .filter((range) => range.name !== inspected.name)
            .flatMap((range) => [...localsOf(source, range)]);

          for (let line = inspected.start + 1; line < inspected.end; line += 1) {
            // Braces and blank lines are not positions a user inspects, and a
            // position before a body opens belongs to no scope in particular.
            const text = lines[line - 1]?.trim() ?? '';
            if (text === '' || text === '{' || text === '}') {
              continue;
            }
            const reported = inspect(source, detected, line);
            const leaked = reported.filter((name) => foreign.includes(name)
              && !localsOf(source, inspected).has(name));
            if (leaked.length > 0) {
              failures.push(
                `break@${detected} inspect@${line} (${inspected.name}) leaked ${leaked.join(',')}`,
              );
            }

            // A capture that reports nothing at all is as useless as a wrong
            // one, so the line must still see something it can name - unless
            // the cut removed everything above it in this function.
            const cutAbove = detected <= inspected.start + 1;
            if (reported.length === 0 && !cutAbove && line > inspected.start + 1) {
              failures.push(`break@${detected} inspect@${line} (${inspected.name}) reported nothing`);
            }
          }
        }
      }
    }

    expect(failures.slice(0, 12).join('\n')).toBe('');
  });

  it('reports a nested block\'s variables when the break is below them', () => {
    // The break sits after a `{ ... }` scope inside mainImage; what the block
    // declared is still gone from scope, but everything before it is not.
    const mainImage = ranges.find((range) => range.name === 'mainImage')!;
    const breakAfter = lines.findIndex((line) => line.includes('float edge =')) + 1;
    const source = [...lines.slice(0, breakAfter), 'd', ...lines.slice(breakAfter)].join('\n');
    const detected = firstUnterminatedStatementLine(source)!;

    const reported = inspect(source, detected, breakAfter);

    expect(reported).toContain('uv');
    expect(reported).toContain('n');
    expect(reported).not.toContain('scoped');
    expect(mainImage.name).toBe('mainImage');
  });

  it('handles two breaks in different functions', () => {
    const first = lines.findIndex((line) => line.includes('float a = hash21(i);')) + 1;
    const second = lines.findIndex((line) => line.includes('float sq = max(')) + 1;
    const source = [
      ...lines.slice(0, first), 'd',
      ...lines.slice(first, second), 'd',
      ...lines.slice(second),
    ].join('\n');

    // Only the first is found, and cutting it leaves the second in place -
    // the capture then fails to compile and the whole-file fallback takes over.
    const detected = firstUnterminatedStatementLine(source)!;
    expect(detected).toBe(first + 1);
    expect(truncateFunctionBodyAt(source, detected)!.split('\n').filter((l) => l.trim() === 'd'))
      .toHaveLength(1);
  });
});
