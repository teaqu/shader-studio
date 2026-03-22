import * as fs from "fs";
import { ShaderProvider } from "../ShaderProvider";
import { GlslFileTracker } from "../GlslFileTracker";
import { Messenger } from "../transport/Messenger";
import { Logger } from "../services/Logger";
import type { ShaderConfig, ErrorMessage } from "@shader-studio/types";

export class ConfigUpdateHandler {
  constructor(
    private glslFileTracker: GlslFileTracker,
    private shaderProvider: ShaderProvider,
    private messenger: Messenger | null,
    private logger: Logger,
  ) {}

  async handleConfigUpdate(payload: {
    config: ShaderConfig;
    text: string;
    shaderPath?: string;
    skipRefresh?: boolean;
  }): Promise<void> {
    try {
      let shaderPath = payload.shaderPath;
      if (!shaderPath) {
        const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
        if (!editor) {
          this.logger.warn("No active shader to update config for");
          return;
        }
        shaderPath = editor.document.uri.fsPath;
      }

      const configPath = shaderPath.replace(/\.(glsl|frag)$/, '.sha.json');
      fs.writeFileSync(configPath, payload.text, 'utf-8');
      this.logger.info(`Config updated: ${configPath}`);

      if (payload.skipRefresh) {
        return;
      }

      setTimeout(() => {
        if (typeof (this.shaderProvider as any).sendShaderFromPath === "function") {
          this.shaderProvider.sendShaderFromPath(shaderPath, { forceCleanup: true });
          return;
        }
        this.logger.warn("ShaderProvider missing sendShaderFromPath during config refresh");
      }, 150);
    } catch (error) {
      this.logger.error(`Failed to update config: ${error}`);
      const errorMsg: ErrorMessage = { type: "error", payload: [`Failed to update shader config: ${error}`] };
      this.messenger?.send(errorMsg);
    }
  }
}
