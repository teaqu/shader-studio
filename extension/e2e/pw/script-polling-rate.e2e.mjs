import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { registerPollingRateScenario } from './script-polling-rate-scenario.mjs';

// Each scenario restores its own config and closes its editor after checking
// reload persistence, so the language variants can share one VS Code profile.
test.use({ vscodeKey: 'script-polling-rate' });
test.afterEach(async ({ vscode }) => {
  await vscode.evaluateInHost(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });
});

registerPollingRateScenario(test, expect, {
  label: 'GLSL',
  shaderPath: join(workspacePath, 'polling-rate.glsl'),
  configPath: join(workspacePath, 'polling-rate.sha.json'),
  script: './polling-rate.uniforms.ts',
});

registerPollingRateScenario(test, expect, {
  label: 'Slang @gpu',
  shaderPath: join(workspacePath, 'polling-rate-slang.slang'),
  configPath: join(workspacePath, 'polling-rate-slang.sha.json'),
  script: './polling-rate-slang.uniforms.ts',
});

registerPollingRateScenario(test, expect, {
  label: 'WGSL @gpu',
  shaderPath: join(workspacePath, 'polling-rate-wgsl.wgsl'),
  configPath: join(workspacePath, 'polling-rate-wgsl.sha.json'),
  script: './polling-rate-wgsl.uniforms.ts',
});
