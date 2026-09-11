import * as fs from "fs";
import { SHADER_LANGUAGES } from "@shader-studio/types";
import { Constants } from "./Constants";

export function isConfigPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(Constants.CONFIG_FILE_EXTENSION);
}

// Every registered shader extension maps to its sibling `.sha.json` config.
// Built from the registry so new languages never need a second edit here.
const SHADER_SOURCE_EXTENSION_PATTERN = new RegExp(
  `\\.(${Object.values(SHADER_LANGUAGES).flatMap((language) => language.extensions).join("|")})$`,
  "i",
);

export function getConfigPathForShaderPath(shaderPath: string): string {
  return shaderPath.replace(SHADER_SOURCE_EXTENSION_PATTERN, Constants.CONFIG_FILE_EXTENSION);
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

  const slangPath = `${base}.slang`;
  if (fs.existsSync(slangPath)) {
    return slangPath;
  }

  const wgslPath = `${base}.wgsl`;
  if (fs.existsSync(wgslPath)) {
    return wgslPath;
  }

  return undefined;
}
