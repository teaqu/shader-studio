import * as fs from "fs";
import { SHADER_LANGUAGES, shaderPathsForConfig } from "@shader-studio/types";
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
  return shaderPathsForConfig(configPath).find((candidate) => fs.existsSync(candidate));
}
