import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { registerScriptUniformErrorScenario } from './script-uniform-error-scenario.mjs';

test.use({ vscodeKey: 'script-uniform-error-glsl' });

registerScriptUniformErrorScenario(test, expect, {
  label: 'GLSL',
  scriptTabShaderPath: join(workspacePath, 'script-tab-error.glsl'),
  missingScriptShaderPath: join(workspacePath, 'script-uniform-error.glsl'),
  missingScriptPath: join(workspacePath, 'script-uniform-error.uniforms.ts'),
  scriptReference: './script-uniform-error.uniforms.ts',
  repairScript: 'export function uniforms() {\n  return { iDayOfWeek: 3 };\n}\n',
});
