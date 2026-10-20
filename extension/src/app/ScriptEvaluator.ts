import * as vm from 'vm';
import { createRequire } from 'module';
import { ScriptRuntime } from '@shader-studio/utils';
import { Logger } from './services/Logger';
import { scriptConsole } from './mcp/McpLogs';
export type { CustomUniformType, CustomUniformValue, ScriptRuntimeState, ScriptLoadResult } from '@shader-studio/utils';

/** Node adapter; browser workers use the same runtime with browser globals. */
export class ScriptEvaluator extends ScriptRuntime {
  constructor() {
    super({
      warn: message => Logger.getInstance().warn(message),
      globals: { WebSocket: globalThis.WebSocket },
      evaluate(code, globals, path) {
        const sandbox = { ...globals, console: scriptConsole(path), require: path ? createRequire(path) : require };
        vm.createContext(sandbox);
        new vm.Script(code + '\n', { filename: 'uniforms-script.js' }).runInContext(sandbox);
        return (sandbox as Record<string, unknown>).__shaderUniforms;
      },
    });
  }
}
