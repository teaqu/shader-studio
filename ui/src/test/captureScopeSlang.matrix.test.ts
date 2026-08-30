import { describe, expect, it } from 'vitest';
import { SlangDebugEngine } from '@shader-studio/debug';
import { firstUnterminatedStatementLine, truncateFunctionBodyAt } from '@shader-studio/rendering';

/**
 * The Slang counterpart of the GLSL scope sweep: put a break on every line of
 * every function in turn, then inspect every other line and check that what the
 * analysis reports belongs to the function being inspected. Runs against the
 * real analyser, with no GPU and no VS Code.
 */
const SHADER = `struct Params
{
    float gain;
    float bias;
};

float3 revcol(float r, float g, float b)
{
    return float3(1.0 - r, 1.0 - g, 1.0 - b);
}

float hash21(float2 p)
{
    float2 q = frac(p * float2(123.34, 456.21));
    q += dot(q, q + 45.32);
    return frac(q.x * q.y);
}

float noise(float2 p)
{
    float2 i = floor(p);
    float2 f = frac(p);
    float a = hash21(i);
    float b = hash21(i + float2(1.0, 0.0));
    return lerp(a, b, f.x);
}

float fbm(float2 p, Params params)
{
    float v = 0.0;
    float amp = params.gain;

    for (int step = 0; step < 3; step++)
    {
        float layer = amp * noise(p);
        if (layer > 0.25)
        {
            v += layer;
        }
        p *= 2.03;
        amp *= 0.5;
    }

    return v + params.bias;
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.xy;
    float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));
    float sq = max(abs(uv.x), abs(uv.y));
    float sqs = smoothstep(0.0, 1.0, sq);

    float n = fbm(uv * 10.0, { 0.5, 0.1 });

    float3 tun = col * sqs * n;
    return float4(tun, 1.0);
}`;


const ROOT = '/shaders/image.slang';

/** Function bodies of the fixture, 1-based and inclusive of their braces. */
function functionRanges(source: string): { name: string; start: number; end: number }[] {
  const lines = source.split('\n');
  const signature = /^\s*(\w[\w<>, ]*?)\s+(\w+)\s*\([^;]*\)\s*\{?\s*$/;
  const ranges: { name: string; start: number; end: number }[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].replace(/\/\/.*$/, '').match(signature);
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
        ranges.push({ name: match[2], start: index + 1, end: scan + 1 });
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
    const name = parameter.trim().split(/\s+/).pop();
    if (name) {
      names.add(name);
    }
  }
  for (const line of lines.slice(1)) {
    const match = line.match(/^\s*(?:\w[\w<>]*)\s+(\w+)\s*(?:=|;)/);
    if (match) {
      names.add(match[1]);
    }
  }
  return names;
}

/** What the Slang analysis sees at one line of a source cut at the break. */
function visibleAt(engine: SlangDebugEngine, source: string, breakLine: number | null, line: number): string[] {
  const code = breakLine === null ? source : truncateFunctionBodyAt(source, breakLine) ?? source;
  const zeroBased = line - 1;
  const lineContent = code.split('\n')[zeroBased] ?? '';
  const files = [{ uri: ROOT, path: ROOT, source: code, version: 1, moduleName: '', ownerPass: 'Image' }];
  const result = engine.analyze({
    workspace: { rootUri: ROOT, rootPath: ROOT, passName: 'Image', files, contentHash: `${code.length}` },
    sourceUri: ROOT,
    position: { line: zeroBased, character: Math.max(0, lineContent.search(/\S/)) },
  });
  return result.ok ? result.analysis.visibleValues.map((value) => value.name) : [];
}

describe('Slang capture scope with a break anywhere in the shader', () => {
  const engine = new SlangDebugEngine();
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

  it("never reports another function's locals, for any break and any inspected line", () => {
    const failures: string[] = [];

    for (const broken of ranges) {
      for (let breakAfter = broken.start + 1; breakAfter < broken.end; breakAfter += 1) {
        const source = [...lines.slice(0, breakAfter), 'd', ...lines.slice(breakAfter)].join('\n');
        const detected = firstUnterminatedStatementLine(source);
        if (detected !== breakAfter + 1) {
          failures.push(`break after ${breakAfter}: detected ${detected}`);
          continue;
        }

        const scoped = functionRanges(source);
        for (const inspected of scoped) {
          const own = localsOf(source, inspected);
          const foreign = scoped
            .filter((range) => range.name !== inspected.name)
            .flatMap((range) => [...localsOf(source, range)])
            .filter((name) => !own.has(name));

          for (let line = inspected.start + 1; line < inspected.end; line += 1) {
            // Braces and blank lines are not positions a user inspects, and a
            // position before a body opens belongs to no scope in particular.
            const cut = truncateFunctionBodyAt(source, detected) ?? source;
            const text = source.split('\n')[line - 1]?.trim() ?? '';
            const cutText = cut.split('\n')[line - 1]?.trim() ?? '';
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
    }

    expect(failures.slice(0, 12).join('\n')).toBe('');
  });

  it('does not treat a struct body as a function to cut', () => {
    const structLine = lines.findIndex((line) => line.includes('float gain;')) + 1;
    const source = [...lines.slice(0, structLine), 'd', ...lines.slice(structLine)].join('\n');

    // `float gain;` terminates, and a struct is not a function body: nothing
    // here should be mistaken for a statement that can be cut short.
    const detected = firstUnterminatedStatementLine(source);
    expect(detected === null || truncateFunctionBodyAt(source, detected) === null).toBe(true);
  });

  it('offers a loop\'s locals on the line that closes it, as GLSL does', () => {
    // Their last-iteration values are what the closing brace is worth reading
    // for, so the capture is taken from the block's final statement.
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
    // The analyser keeps a loop body's variables visible after the loop, which
    // is how it reports their last-iteration values. Whatever it decides, the
    // cut must not change it: that is what this pins.
    expect(reported).toEqual(visibleAt(engine, SHADER, null, breakAfter));
  });
});
