import { describe, expect, it } from 'vitest';
import { decodeWgslTrace, emitWgslTracePrelude, planWgslTraceProgram } from '../index';

describe('public trace module exports', () => {
  it('plans, emits and decodes a fragment recording through the module boundary', () => {
    const plan = planWgslTraceProgram({ source: '@fragment fn fragmentMain(@builtin(position) p: vec4f) -> @location(0) vec4f { return p; }', entryPoint: 'fragmentMain', stage: 'fragment', capacity: 8, sourceRanges: [{ path: '/image.wgsl', startLine: 1, endLine: 1 }] });
    expect(plan.sites).toHaveLength(1);
    expect(emitWgslTracePrelude(plan)).toContain('records: array<_ss_trace_Record>');
    expect(decodeWgslTrace(plan, new ArrayBuffer(16 + plan.capacity * plan.recordWords * 4))).toEqual({ events: [], overflow: false });
  });
});
