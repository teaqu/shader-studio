import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';
import { registerPollingRateScenario } from './script-polling-rate-scenario.mjs';

test.use({ vscodeKey: 'script-polling-rate-slang' });

registerPollingRateScenario(test, expect, {
  label: 'Slang @gpu',
  shaderPath: join(workspacePath, 'polling-rate-slang.slang'),
  configPath: join(workspacePath, 'polling-rate-slang.sha.json'),
  script: './polling-rate-slang.uniforms.ts',
});
