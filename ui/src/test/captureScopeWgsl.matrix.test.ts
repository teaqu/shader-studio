import { describe, expect, it } from 'vitest';
import { WgslDebugEngine } from '@shader-studio/debug';
import { firstUnterminatedStatementLine, truncateFunctionBodyAt } from '@shader-studio/rendering';

/**
 * The WGSL counterpart of the GLSL and Slang scope sweeps: put a break on every
 * line of every function in turn, then inspect every other line and check that
 * what the analysis reports belongs to the function being inspected. Runs
 * against the real analyser, with no GPU and no VS Code.
 */
const SHADER = `struct Params
{
    gain: f32,
    bias: f32,
};

fn revcol(r: f32, g: f32, b: f32) -> vec3f
{
    return vec3f(1.0 - r, 1.0 - g, 1.0 - b);
}

fn hash21(p: vec2f) -> f32
{
    var q = fract(p * vec2f(123.34, 456.21));
    q += dot(q, q + 45.32);
    return fract(q.x * q.y);
}

fn noise(p: vec2f) -> f32
{
    let i = floor(p);
    let f = fract(p);
    let a = hash21(i);
    let b = hash21(i + vec2f(1.0, 0.0));
    return mix(a, b, f.x);
}

fn fbm(start: vec2f, params: Params) -> f32
{
    var p = start;
    var v = 0.0;
    var amp = params.gain;

    for (var step = 0; step < 3; step++)
    {
        let layer = amp * noise(p);
        if (layer > 0.25)
        {
            v += layer;
        }
        p *= 2.03;
        amp *= 0.5;
    }

    return v + params.bias;
}

fn mainImage(fragCoord: vec2f) -> vec4f
{
    let uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.xy;
    let col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3f(0.0, 2.0, 4.0));
    let sq = max(abs(uv.x), abs(uv.y));
    let sqs = smoothstep(0.0, 1.0, sq);

    let n = fbm(uv * 10.0, Params(0.5, 0.1));

    let tun = col * sqs * n;
    return vec4f(tun, 1.0);
}`;

const ROOT = '/shaders/image.wgsl';

/** Function bodies of the fixture, 1-based and inclusive of their braces. */
function functionRanges(source: string): { name: string; start: number; end: number }[] {
  const lines = source.split('\n');
  const ranges: { name: string; start: number; end: number }[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*fn\s+(\w+)\s*\(/);
    if (!match) {
      continue;
    }
    let depth = 0;
    let opened = false;
    for (let scan = index; scan < lines.length; scan += 1) {
      for (const character of lines[scan]) {
        if (character === '{') {
          depth += 1;
          opened = true;
        } else if (character === '}') {
          depth -= 1;
        }
      }
      if (opened && depth === 0) {
        ranges.push({ name: match[1], start: index + 1, end: scan + 1 });
        index = scan;
        break;
      }
    }
  }
  return ranges;
}

/** Names belonging to one function: its parameters and its declarations. */
function localsOf(source: string, range: { start: number; end: number }): Set<string> {
  const names = new Set<string>();
  const lines = source.split('\n').slice(range.start - 1, range.end);
  for (const parameter of lines[0]?.match(/\(([^)]*)\)/)?.[1]?.split(',') ?? []) {
    const name = parameter.split(':')[0]?.trim();
    if (name) {
      names.add(name);
    }
  }
  for (const line of lines.slice(1)) {
    const match = line.match(/^\s*(?:for\s*\(\s*)?(?:let|var|const)\s+(\w+)/);
    if (match) {
      names.add(match[1]);
    }
  }
  return names;
}

/** What the WGSL analysis sees at one line of a source cut at the break. */
function visibleAt(engine: WgslDebugEngine, source: string, breakLine: number | null, line: number): string[] {
  const code = breakLine === null ? source : truncateFunctionBodyAt(source, breakLine) ?? source;
  const zeroBased = line - 1;
  const lineContent = code.split('\n')[zeroBased] ?? '';
  const files = [{ uri: ROOT, path: ROOT, source: code, version: 1, moduleName: '', ownerPass: 'Image' }];
  const result = engine.analyze({
    workspace: {
      rootUri: ROOT, rootPath: ROOT, passName: 'Image', files, contentHash: `${code.length}`,
      storage: {}, channels: [], customUniforms: [],
    },
    sourceUri: ROOT,
    position: { line: zeroBased, character: Math.max(0, lineContent.search(/\S/)) },
  });
  return result.ok ? result.analysis.visibleValues.map((value) => value.name) : [];
}

describe('WGSL capture scope with a break anywhere in the shader', () => {
  const engine = new WgslDebugEngine();
  const ranges = functionRanges(SHADER);
  const lines = SHADER.split('\n');

  it('finds every function in the fixture', () => {
    expect(ranges.map((range) => range.name))
      .toEqual(['revcol', 'hash21', 'noise', 'fbm', 'mainImage']);
  });

  it('scopes values correctly with no break at all', () => {
    const hash21 = ranges.find((range) => range.name === 'hash21')!;
    const visible = visibleAt(engine, SHADER, null, hash21.end - 1);

    // revcol's parameters must not be visible inside hash21.
    expect(visible).not.toContain('r');
    expect(visible).not.toContain('g');
    expect(visible).toContain('q');
  });

  it('reports values on a healthy shader', () => {
    const mainImage = ranges.find((range) => range.name === 'mainImage')!;

    expect(visibleAt(engine, SHADER, null, mainImage.end - 1)).toContain('tun');
  });

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
        const code = cutLines.map((line) => line.replace(/\/\/.*$/, '')).join('\n');
        const opens = (code.match(/\{/g) ?? []).length;
        const closes = (code.match(/\}/g) ?? []).length;
        if (opens !== closes) {
          failures.push(`break@${detected}: braces unbalanced (${opens} vs ${closes})`);
        }
      }
    }

    expect(failures.slice(0, 12).join('\n')).toBe('');
  });

  it.each(ranges.map((range) => [range.name, range] as const))(
    "never reports another function's locals for any break inside %s",
    (_name, broken) => {
      const failures: string[] = [];

      for (let breakAfter = broken.start + 1; breakAfter < broken.end; breakAfter += 1) {
        const source = [...lines.slice(0, breakAfter), 'd', ...lines.slice(breakAfter)].join('\n');
        const detected = firstUnterminatedStatementLine(source);
        if (detected !== breakAfter + 1) {
          failures.push(`break after ${breakAfter}: detected ${detected}`);
          continue;
        }

        const cut = truncateFunctionBodyAt(source, detected) ?? source;
        const sourceLines = source.split('\n');
        const cutLines = cut.split('\n');
        const scoped = functionRanges(source);
        const localsByRange = scoped.map((range) => localsOf(source, range));

        for (const [index, inspected] of scoped.entries()) {
          const own = localsByRange[index]!;
          const foreign = localsByRange
            .flatMap((locals, other) => (other === index ? [] : [...locals]))
            .filter((name) => !own.has(name));

          for (let line = inspected.start + 1; line < inspected.end; line += 1) {
            const text = sourceLines[line - 1]?.trim() ?? '';
            const cutText = cutLines[line - 1]?.trim() ?? '';
            // Braces and blank lines are not positions a user inspects, and the
            // cut leaves the break line itself empty.
            if ([text, cutText].some((value) => value === '' || value === '{' || value === '}')) {
              continue;
            }
            const reported = visibleAt(engine, source, detected, line);
            const leaked = reported.filter((name) => foreign.includes(name));
            if (leaked.length > 0) {
              failures.push(`break@${detected} inspect@${line} (${inspected.name}) leaked ${leaked.join(',')}`);
            }

            // Reporting nothing is as useless as reporting the wrong thing,
            // unless the cut removed everything above the inspected line.
            if (reported.length === 0 && detected > inspected.start + 2 && line > inspected.start + 2) {
              failures.push(`break@${detected} inspect@${line} (${inspected.name}) reported nothing`);
            }
          }
        }
      }

      expect(failures.slice(0, 12).join('\n')).toBe('');
    },
  );

  it('does not treat a struct body as a function to cut', () => {
    const structLine = lines.findIndex((line) => line.includes('gain: f32,')) + 1;
    const source = [...lines.slice(0, structLine), 'd', ...lines.slice(structLine)].join('\n');

    const detected = firstUnterminatedStatementLine(source);
    expect(detected === null || truncateFunctionBodyAt(source, detected) === null).toBe(true);
  });

  it('offers a loop\'s locals on the line that closes it, as GLSL and Slang do', () => {
    const loopClose = lines.findIndex((line, index) =>
      line.trim() === '}' && lines[index - 1]?.includes('amp *= 0.5;')) + 1;

    const reported = visibleAt(engine, SHADER, null, loopClose);

    expect(reported).toContain('layer');
    expect(reported).toContain('v');
  });

  it('scopes a line after a loop exactly as it would with no break at all', () => {
    const breakAfter = lines.findIndex((line) => line.includes('return v + params.bias;'));
    const source = [...lines.slice(0, breakAfter), 'd', ...lines.slice(breakAfter)].join('\n');
    const detected = firstUnterminatedStatementLine(source)!;

    const reported = visibleAt(engine, source, detected, breakAfter);

    expect(reported).toContain('v');
    expect(reported).toContain('amp');
    expect(reported).toEqual(visibleAt(engine, SHADER, null, breakAfter));
  });
});
