import { describe, expect, it } from 'vitest';
import { parseWgslDocument } from '@shader-studio/wgsl-analysis';
import { applySourceEdits } from '@shader-studio/utils/source-edits';
import { planWgslTraceCalls } from '../WgslTraceCalls';

function instrument(source: string, authored: (line: number) => boolean = () => true) {
  const document = parseWgslDocument('/calls.wgsl', source, 'compute');
  expect(document.parsedSuccessfully).toBe(true);
  const result = applySourceEdits(source, planWgslTraceCalls(document, authored).edits);
  if (!result.ok) {
    throw new Error('Overlapping call edits');
  }
  expect(parseWgslDocument('/calls.instrumented.wgsl', result.source, 'compute').parsedSuccessfully).toBe(true);
  return result.source;
}

describe('planWgslTraceCalls', () => {
  it('instruments both explicit void returns and implicit void fallthrough', () => {
    const result = instrument(`fn implicit() {
  let value = 1u;
}
fn explicit() {
  return;
}`);
    expect(result).toMatch(/fn implicit\(\) \{\s+_ss_trace_enter\(\);[\s\S]*_ss_trace_exit\(\);\s*\}/);
    expect(result).toContain('_ss_trace_exit(); return;');
    expect((result.match(/_ss_trace_enter\(\)/g) ?? [])).toHaveLength(2);
    expect((result.match(/_ss_trace_exit\(\)/g) ?? [])).toHaveLength(2);
  });

  it('stores each non-void nested-call return once before exiting', () => {
    const result = instrument(`fn nested(value: f32) -> f32 { return value * 2.0; }
fn caller() -> f32 { return nested(0.25); }`);
    expect((result.match(/nested\(0\.25\)/g) ?? [])).toHaveLength(1);
    expect(result).toMatch(/let _ss_trace_return\d+: f32 = nested\(0\.25\); _ss_trace_exit\(\); return _ss_trace_return\d+;/);
    expect(result).toMatch(/let _ss_trace_return\d+: f32 = value \* 2\.0; _ss_trace_exit\(\); return _ss_trace_return\d+;/);
  });

  it('preserves contextual abstract integer conversion in returns', () => {
    const result = instrument('fn unsigned() -> u32 { return 1; }');
    expect(result).toContain('let _ss_trace_return0: u32 = 1;');
  });

  it('exits each conditional early return before the caller returns', () => {
    const result = instrument(`fn helper(value: f32) -> f32 {
  if (value > 0.0) { return value; }
  return -value;
}
fn caller() -> f32 {
  return helper(-1.0);
}`);
    expect((result.match(/_ss_trace_exit\(\); return _ss_trace_return\d+;/g) ?? [])).toHaveLength(3);
    expect(result).toMatch(/if \(value > 0\.0\) \{ let _ss_trace_return\d+: f32 = value; _ss_trace_exit\(\); return _ss_trace_return\d+; \}/);
    expect(result).toMatch(/let _ss_trace_return\d+: f32 = helper\(-1\.0\); _ss_trace_exit\(\); return _ss_trace_return\d+;/);
  });

  it('excludes generated wrapper callables from authored-range edits', () => {
    const result = instrument(`fn generatedBefore() -> f32 { return 1.0; }
fn authored() -> f32 { return 2.0; }
fn generatedAfter() -> f32 { return 3.0; }`, line => line === 2);
    expect(result).toMatch(/fn generatedBefore\(\) -> f32 \{ return 1\.0; \}/);
    expect(result).toMatch(/fn authored\(\) -> f32 \{\s+_ss_trace_enter\(\);\s+let _ss_trace_return0: f32 = 2\.0; _ss_trace_exit\(\); return _ss_trace_return0;\s+\}/);
    expect(result).toMatch(/fn generatedAfter\(\) -> f32 \{ return 3\.0; \}/);
    expect((result.match(/_ss_trace_enter\(\)/g) ?? [])).toHaveLength(1);
  });
});
