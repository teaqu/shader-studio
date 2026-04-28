import * as fs from "fs";
import { Constants } from "./Constants";

export function isConfigPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(Constants.CONFIG_FILE_EXTENSION);
}

export function getShaderPathFromConfigPath(configPath: string): string | undefined {
  if (!isConfigPath(configPath)) {
    return undefined;
  }

  const base = configPath.replace(/\.sha\.json$/i, "");
  const glslPath = `${base}.glsl`;
  if (fs.existsSync(glslPath)) {
    return glslPath;
  }

  const fragPath = `${base}.frag`;
  if (fs.existsSync(fragPath)) {
    return fragPath;
  }

  return undefined;
}
