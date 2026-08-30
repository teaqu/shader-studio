import { describe, expect, it } from 'vitest';
import { VariableCaptureBuilder } from '@shader-studio/debug';
import { firstUnterminatedStatementLine, truncateFunctionBodyAt } from '@shader-studio/rendering';

/**
 * Half-typed statements a user leaves behind mid-edit. Each one has to be found
 * as the break, and the capture above it has to stay in the scope the cursor is
 * actually in - a loop that has closed must not still be contributing values.
 */
function shader(stray: string): string {
  return `vec3 planets[4];
vec3 colours[4];

float getLen(vec3 p, vec3 q) { return length(p - q); }
float frameDistance(vec3 p, float d) { return d; }

vec3 getColour(vec3 p, float d) {
    float minDist = getLen(p, planets[0]);
    int mini = 0;
    for (int i = 1; i < planets.length(); ++i) {
        float dist = getLen(p, planets[i]);
        if (dist < minDist) {
            minDist = dist;
            mini = i;
        }
    }
${stray}
    // Floor
    float frame = frameDistance(p, d);
    if (frame < minDist) {
        return vec3(min(max(5.0 / (d * 3.0), 0.05), 0.4));
    } else {
        return colours[mini];
    }
}`;
}

/** 1-based line the stray token sits on in every fixture above. */
const STRAY_LINE = 17;

describe.each([
  ['an assignment with no right-hand side', '    float test ='],
  ['a bare identifier', '    u '],
  ['a half-typed if', '   if  '],
  ['a half-typed switch', '    switch  '],
  ['a half-typed for', '    for'],
  ['a half-typed while', '    while '],
])('%s left behind before a comment', (_name, stray) => {
  const source = shader(stray);

  it('is found as the break', () => {
    expect(firstUnterminatedStatementLine(source)).toBe(STRAY_LINE);
  });

  it('is cut away, leaving the source balanced', () => {
    const cut = truncateFunctionBodyAt(source, STRAY_LINE)!;

    expect(cut).not.toBeNull();
    expect(cut.split('\n')).toHaveLength(source.split('\n').length);
    // The break line is left empty; the return goes on the line after it.
    expect(cut.split('\n')[STRAY_LINE - 1].trim()).toBe('');
    expect(cut.split('\n')[STRAY_LINE].trim()).toBe('return vec3(0);');
    const code = cut.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
    expect((code.match(/\{/g) ?? []).length).toBe((code.match(/\}/g) ?? []).length);
  });

  it('offers the loop\'s locals on the line that closes it', () => {
    // Their last-iteration values are worth reading there, which is why the
    // capture shadows them rather than dropping them.
    const cut = truncateFunctionBodyAt(source, STRAY_LINE)!;
    const loopClose = cut.split('\n').findIndex((line, index, all) =>
      line.trim() === '}' && all[index - 1]?.trim() === '}');

    const names = VariableCaptureBuilder
      .getAllInScopeVariables(cut, loopClose)
      .map((variable) => variable.varName);

    expect(names).toContain('minDist');
    expect(names).toContain('i');
  });

  it('captures the values that survive the loop, not the loop\'s own', () => {
    const cut = truncateFunctionBodyAt(source, STRAY_LINE)!;
    // Inspect the last line above the break, which is outside the closed loop.
    const names = VariableCaptureBuilder
      .getAllInScopeVariables(cut, STRAY_LINE - 1)
      .map((variable) => variable.varName);

    // The break line the capture lands on sits at the body's own depth, past
    // the loop - so the loop's own variables are not part of this reading.
    expect(names).toContain('minDist');
    expect(names).toContain('mini');
    expect(names).not.toContain('i');
    expect(names).not.toContain('dist');
  });
});
