import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { registerScriptUniformErrorScenario } from './script-uniform-error-scenario.mjs';

test.use({ vscodeKey: 'script-uniform-error-wgsl' });

registerScriptUniformErrorScenario(test, expect, {
  label: 'WGSL @gpu',
  // WGSL diagnostics carry no "error" prefix; match the parser's own message.
  brokenSourcePattern: /WGSL L3:\d+ missing initializer/,
  scriptTabShaderPath: join(workspacePath, 'script-tab-error-wgsl.wgsl'),
  missingScriptShaderPath: join(workspacePath, 'script-uniform-error-wgsl.wgsl'),
  missingScriptPath: join(workspacePath, 'script-uniform-error-wgsl.uniforms.ts'),
  scriptReference: './script-uniform-error-wgsl.uniforms.ts',
  repairScript: 'export function uniforms() {\n  return { iDayOfWeek: 3 };\n}\n',
  restoreScript: 'export function uniforms() {\n  return { iDayOfWeek: 3 };\n}\n',
});
