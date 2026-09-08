import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { registerPollingRateScenario } from './script-polling-rate-scenario.mjs';

test.use({ vscodeKey: 'script-polling-rate-glsl' });

registerPollingRateScenario(test, expect, {
  label: 'GLSL',
  shaderPath: join(workspacePath, 'polling-rate.glsl'),
  configPath: join(workspacePath, 'polling-rate.sha.json'),
  script: './polling-rate.uniforms.ts',
});
