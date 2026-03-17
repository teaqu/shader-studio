import * as path from "path";
import * as esbuild from "esbuild";
import { Logger } from "./services/Logger";

export interface BundleResult {
  success: boolean;
  code?: string;
  error?: string;
}

export class ScriptBundler {
  private logger = Logger.getInstance();

  public async bundle(scriptPath: string, content?: string): Promise<BundleResult> {
    try {
      const buildOptions: esbuild.BuildOptions = {
        bundle: true,
        format: "iife",
        globalName: "__shaderUniforms",
        write: false,
        platform: "node",
        target: "es2020",
        packages: "external",
      };

      if (content !== undefined) {
        // Bundle from in-memory content (unsaved editor buffer)
        const ext = path.extname(scriptPath);
        const loader = ext === ".ts" || ext === ".tsx" ? "ts" : "js";
        buildOptions.stdin = {
          contents: content,
          resolveDir: path.dirname(scriptPath),
          sourcefile: path.basename(scriptPath),
          loader,
        };
      } else {
        buildOptions.entryPoints = [scriptPath];
      }

      const result = await esbuild.build(buildOptions);

      if (result.errors.length > 0) {
        const errorMsg = result.errors.map(e => e.text).join("\n");
        return { success: false, error: errorMsg };
      }

      const code = result.outputFiles?.[0]?.text;
      if (!code) {
        return { success: false, error: "No output from esbuild" };
      }

      return { success: true, code };
    } catch (err: any) {
      const message = err?.message || String(err);
      this.logger.warn(`Script bundle failed: ${message}`);
      return { success: false, error: message };
    }
  }
}
