import { registerScriptContextTests } from './script-context-cases.mjs';
import { test } from './fixtures.mjs';

// The three language journeys each open their own shader, then close its
// editor/preview. Sharing this worker removes two otherwise identical launches.
test.use({ vscodeKey: 'script-context' });

registerScriptContextTests('glsl');
registerScriptContextTests('slang');
registerScriptContextTests('wgsl');
