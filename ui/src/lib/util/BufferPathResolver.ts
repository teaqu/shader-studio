import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";

export class BufferPathResolver {
  private renderEngine: RenderingEngine;

  constructor(renderEngine: RenderingEngine) {
    this.renderEngine = renderEngine;
  }

  public bufferFileExistsInCurrentShader(filePath: string): boolean {
    const config = this.renderEngine.getCurrentConfig();
    if (config?.passes) {
      return Object.entries(config.passes).some(([passName, passConfig]) => {
        if (passName === "Image" || typeof passConfig !== "object" || !passConfig || !("path" in passConfig)) {
          return false;
        }

        return this.pathsMatch(filePath, (passConfig as { path?: string }).path);
      });
    }

    const passes = this.renderEngine.getPasses();
    return passes.some((pass: any) => {
      if (pass.name === "Image") {
        return false;
      }

      const bufferConfig = this.getBufferConfigForPass(pass.name);
      return this.pathsMatch(filePath, bufferConfig?.path);
    });
  }

  public getBufferNameForFilePath(filePath: string): string | null {
    const config = this.renderEngine.getCurrentConfig();
    if (config?.passes) {
      for (const [passName, passConfig] of Object.entries(config.passes)) {
        if (passName === "Image" || typeof passConfig !== "object" || !passConfig || !("path" in passConfig)) {
          continue;
        }

        if (this.pathsMatch(filePath, (passConfig as { path?: string }).path)) {
          return passName;
        }
      }

      return null;
    }

    const passes = this.renderEngine.getPasses();
    for (const pass of passes) {
      if (pass.name === "Image") {
        continue;
      }

      const bufferConfig = this.getBufferConfigForPass(pass.name);
      if (this.pathsMatch(filePath, bufferConfig?.path)) {
        return pass.name;
      }
    }

    return null;
  }

  private pathsMatch(filePath: string, configPath: string | undefined): boolean {
    if (!configPath) {
      return false;
    }

    const normalizedIncomingPath = filePath.replace(/\\/g, '/');
    const normalizedConfigPath = configPath.replace(/\\/g, '/');

    return normalizedIncomingPath === normalizedConfigPath ||
      normalizedIncomingPath.endsWith('/' + normalizedConfigPath.split('/').pop()) ||
      normalizedConfigPath.endsWith('/' + normalizedIncomingPath.split('/').pop());
  }

  private getBufferConfigForPass(bufferName: string): { path?: string } | null {
    const config = this.renderEngine.getCurrentConfig();
    if (!config || !config.passes) {
      return null;
    }

    const bufferPass = config.passes[bufferName];
    if (!bufferPass || typeof bufferPass !== 'object' || !('path' in bufferPass)) {
      return null;
    }

    return bufferPass as { path?: string };
  }
}
