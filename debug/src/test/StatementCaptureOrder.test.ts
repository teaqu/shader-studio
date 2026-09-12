import { describe, expect, it } from 'vitest';
import { SlangDebugEngine, WgslDebugEngine } from '../index';

for (const language of ['wgsl', 'slang'] as const) {
  describe(`${language} assignment capture order`, () => {
    for (const mode of ['preview', 'capture'] as const) {
      it.each(['formula', 'iffy', 'whileValue', 'switchValue', 'returnValue', 'loopValue', 'doubleValue'])(`${mode} captures %s after assignment`, name => {
        const source = language === 'wgsl'
          ? `fn mainImage(p: vec2f) -> vec4f {\n  var ${name}: f32 = 0.125;\n  ${name} = 0.375;\n  return vec4f(${name});\n}`
          : `float4 mainImage(float2 p) {\n  float ${name} = 0.125;\n  ${name} = 0.375;\n  return float4(${name});\n}`;
        const uri = `/image.${language}`;
        const request = { workspace: { rootUri: uri, rootPath: uri, passName: 'Image', contentHash: 'abcd1234',
          files: [{ uri, path: uri, source, version: 1, moduleName: '', ownerPass: 'Image' }],
        }, sourceUri: uri, position: { line: 2, character: 2 } };
        const engine = language === 'wgsl' ? new WgslDebugEngine() : new SlangDebugEngine();
        const analysis = engine.analyze(request);
        if (!analysis.ok) {
          throw new Error(JSON.stringify(analysis));
        }
        const value = analysis.analysis.visibleValues.find(value => value.name === name)!;
        expect(value).toBeDefined();
        const result = mode === 'preview'
          ? engine.planPreview(request, { normalizeMode: 'off', stepEdge: null })
          : engine.planCapture(request, [value.id]);
        if (!result.ok) {
          throw new Error(JSON.stringify(result));
        }
        const output = result.plan.files[0].source;
        const assignment = output.indexOf(`${name} = 0.375;`);
        const capture = output.indexOf(`_slot1 = ${name};`);
        expect(assignment).toBeGreaterThan(-1);
        expect(capture).toBeGreaterThan(assignment);
      });
    }
  });
}
