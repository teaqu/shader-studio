import type { WgslTraceEvent, WgslTracePlan } from '@shader-studio/types';

function serializableFloat(value: number): number | string {
  if (Object.is(value, -0)) {
    return '-0';
  }
  return Number.isFinite(value) ? value : String(value);
}

export function decodeWgslTrace(plan: WgslTracePlan, data: ArrayBuffer): { events: WgslTraceEvent[]; overflow: boolean } {
  if (data.byteLength !== 16 + plan.capacity * plan.recordWords * 4) {
    throw new Error('Invalid WGSL trace buffer size.');
  }
  const words = new Uint32Array(data);
  const floats = new Float32Array(data);
  const signed = new Int32Array(data);
  const events: WgslTraceEvent[] = [];
  const count = Math.min(words[0], plan.capacity);
  for (let index = 0; index < count; index++) {
    const offset = 4 + index * plan.recordWords;
    const site = plan.sites[words[offset]];
    if (!site || site.id !== words[offset]) {
      throw new Error('Invalid WGSL trace site id.');
    }
    const values = site.variables.map((variable, slot) => {
      const start = offset + 4 + slot * 4;
      const components = Array.from({ length: variable.width }, (_, lane) => {
        const word = start + lane;
        return variable.component === 'f32' ? serializableFloat(floats[word]) : variable.component === 'i32' ? signed[word] : words[word];
      });
      const value = variable.component === 'bool' ? components[0] !== 0
        : variable.width === 1 ? components[0] : components;
      return { name: variable.name, type: variable.type, value };
    });
    values.push(...(site.unavailableVariables ?? []).map(variable => ({ name: variable.name, type: variable.type,
      value: '<not recorded: unsupported or unresolved type>' })));
    events.push({ siteId: site.id, line: site.line, column: site.column, values });
  }
  return { events, overflow: words[1] !== 0 || words[0] > plan.capacity };
}
