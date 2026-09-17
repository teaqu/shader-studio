import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { registerPollingRateScenario } from './script-polling-rate-scenario.mjs';

test.use({ vscodeKey: 'script-polling-rate-wgsl' });

registerPollingRateScenario(test, expect, {
  label: 'WGSL @gpu',
  shaderPath: join(workspacePath, 'polling-rate-wgsl.wgsl'),
  configPath: join(workspacePath, 'polling-rate-wgsl.sha.json'),
  script: './polling-rate-wgsl.uniforms.ts',
});
