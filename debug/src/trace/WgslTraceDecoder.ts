import type { WgslTraceEvent, WgslTracePlan, WgslTraceValue, WgslTraceValueShape, WgslTraceFrame } from '@shader-studio/types';

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
  const frames = new Map<number, { frame: WgslTraceFrame; parent: number }>();
  const count = Math.min(words[0], plan.capacity);
  for (let index = 0; index < count; index++) {
    const offset = 4 + index * plan.recordWords;
    const site = plan.sites[words[offset]];
    if (!site || site.id !== words[offset]) {
      throw new Error('Invalid WGSL trace site id.');
    }
    const leaves: WgslTraceValue[] = site.variables.map((variable, slot) => {
      const start = offset + 4 + slot * 4;
      const components = Array.from({ length: variable.width }, (_, lane) => {
        const word = start + lane;
        return variable.component === 'f32' ? serializableFloat(floats[word]) : variable.component === 'i32' ? signed[word] : words[word];
      });
      const typed = variable.component === 'bool' ? components.map(component => component !== 0) : components;
      const value = variable.width === 1 ? typed[0] : typed;
      return { name: variable.name, type: variable.type, value };
    });
    const values = site.valueShapes ? site.valueShapes.map(shape => expandShape(shape, leaves)) : leaves;
    values.push(...(site.unavailableVariables ?? []).map(variable => ({ name: variable.name, type: variable.type,
      value: '<not recorded: unsupported or unresolved type>' })));
    const stack = decodeFrames(plan, site, values, words.slice(offset, offset + 4), frames);
    events.push({ ...(stack.length ? { frames: stack } : {}), siteId: site.id, ...(site.path === undefined ? {} : { path: site.path }),
      ...(site.functionName === undefined ? {} : { functionName: site.functionName }),
      line: site.line, column: site.column, values });
  }
  return { events, overflow: words[1] !== 0 || words[0] > plan.capacity };
}

function expandShape(shape: WgslTraceValueShape, leaves: WgslTraceValue[]): WgslTraceValue {
  if (shape.slot !== undefined) {
    const leaf = leaves[shape.slot];
    if (!leaf) {
      throw new Error('Invalid WGSL trace value slot.');
    }
    return { ...leaf, name: shape.name, type: shape.type };
  }
  const children = (shape.children ?? []).map(child => expandShape(child, leaves));
  return { name: shape.name, type: shape.type, value: `${shape.type} (${children.length})`, children };
}

function decodeFrames(plan: WgslTracePlan, site: WgslTracePlan['sites'][number], values: WgslTraceValue[],
  metadata: Uint32Array, frames: Map<number, { frame: WgslTraceFrame; parent: number }>): WgslTraceFrame[] {
  const stack: WgslTraceFrame[] = [];
  const frameId = metadata[2];
  if (frameId !== 0) {
    const depth = metadata[1];
    const parent = metadata[3];
    if (!depth || depth > (plan.stackSize ?? 256) || parent === frameId) {
      throw new Error('Invalid WGSL trace frame metadata.');
    }
    frames.set(frameId, { parent, frame: { id: frameId, functionName: site.functionName ?? 'mainImage',
      ...(site.path === undefined ? {} : { path: site.path }), line: site.line, column: site.column, values } });
    let current = frameId;
    while (current && stack.length < depth) {
      const entry = frames.get(current);
      if (!entry || stack.some(frame => frame.id === current)) {
        throw new Error('Invalid WGSL trace caller metadata.');
      }
      stack.push(entry.frame);
      current = entry.parent;
    }
    if (current || stack.length !== depth) {
      throw new Error('Invalid WGSL trace stack depth.');
    }
  }
  return stack;
}
