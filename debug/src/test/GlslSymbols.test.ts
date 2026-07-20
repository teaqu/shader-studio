import { describe, it, expect } from 'vitest';
import { getSymbolTable, findSymbol } from '../GlslSymbols';

const lines = [
  '#define MAX_STEPS 64',
  'struct Ray { vec3 origin; vec3 direction; };',
  'const float EPSILON = 0.001;',
  '',
  'float sdSphere(vec3 p, float r) {',
  '  return length(p) - r;',
  '}',
  '',
  'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
  '  fragColor = vec4(sdSphere(vec3(0.0), 1.0));',
  '}',
];

describe('getSymbolTable', () => {
  it('indexes functions with line, column, and signature', () => {
    const table = getSymbolTable(lines);
    const sdSphere = table.functions.find((f) => f.name === 'sdSphere');
    expect(sdSphere).toMatchObject({ line: 4, column: 6 });
    expect(sdSphere?.signature).toContain('sdSphere(vec3 p, float r)');
  });

  it('indexes structs and defines', () => {
    const table = getSymbolTable(lines);
    expect(findSymbol(table, 'Ray')).toMatchObject({ line: 1, column: 7 });
    expect(findSymbol(table, 'MAX_STEPS')).toMatchObject({ line: 0, column: 8 });
  });

  it('indexes globals', () => {
    const table = getSymbolTable(lines);
    expect(findSymbol(table, 'EPSILON')).toMatchObject({ line: 2 });
  });

  it('findSymbol prefers functions over defines over globals with real collisions', () => {
    const collision = [
      '#define glow 1.0',
      'float glow(vec3 p) { return 0.5; }',
      '#define shade 2.0',
      'const float shade = 0.3;',
    ];
    const table = getSymbolTable(collision);
    // functions > defines: glow function on line 1 should win over define on line 0
    expect(findSymbol(table, 'glow')).toMatchObject({ line: 1 });
    // defines > globals: shade define on line 2 should win over global on line 3
    expect(findSymbol(table, 'shade')).toMatchObject({ line: 2 });
  });

  it('still finds functions by regex when the parse fails', () => {
    const broken = [
      'float ( // unparseable',
      'float sdBox(vec3 p) {',
      '  return 0.0;',
      '}',
    ];
    const table = getSymbolTable(broken);
    expect(findSymbol(table, 'sdBox')).toMatchObject({ line: 1 });
  });

  it('returns undefined for unknown names', () => {
    expect(findSymbol(getSymbolTable(lines), 'nope')).toBeUndefined();
  });
});
