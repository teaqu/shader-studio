import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { registerScriptUniformErrorScenario } from './script-uniform-error-scenario.mjs';

test.use({ vscodeKey: 'script-uniform-error-slang' });

registerScriptUniformErrorScenario(test, expect, {
  label: 'Slang @gpu',
  scriptTabShaderPath: join(workspacePath, 'script-tab-error-slang.slang'),
  missingScriptShaderPath: join(workspacePath, 'script-uniform-error-slang.slang'),
  missingScriptPath: join(workspacePath, 'script-uniform-error-slang.uniforms.ts'),
  scriptReference: './script-uniform-error-slang.uniforms.ts',
  repairScript: 'export function uniforms() {\n  return { iDayOfWeek: 3 };\n}\n',
  restoreScript: 'export function uniforms() {\n  return { iDayOfWeek: 3 };\n}\n',
});
