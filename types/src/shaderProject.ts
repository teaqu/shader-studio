import type { AuthoringResource, ShaderStage } from "./shader-environment/ShaderAuthoringEnvironment";
import { SHADER_LANGUAGES } from "./shader-environment/ShaderLanguages";
import type { ShaderConfig } from "./ShaderConfig";

/** Every registered shader extension, longest first so alternations prefer it. */
const SHADER_EXTENSIONS = Object.values(SHADER_LANGUAGES)
  .flatMap((language) => language.extensions)
  .sort((left, right) => right.length - left.length);

const SHADER_SOURCE_EXTENSION_PATTERN = new RegExp(`\\.(${SHADER_EXTENSIONS.join("|")})$`, "i");

/** Maps a shader source path to its sibling `.sha.json` config path.
 * Paths with no registered shader extension pass through unchanged. */
export function configPathForShader(shaderPath: string): string {
  return shaderPath.replace(SHADER_SOURCE_EXTENSION_PATTERN, ".sha.json");
}

const CONFIG_EXTENSION_PATTERN = /\.sha\.json$/i;

/** Candidate shader source paths for a config, in registry order. Callers
 * pick the first candidate that exists in their own filesystem. */
export function shaderPathsForConfig(configPath: string): string[] {
  if (!CONFIG_EXTENSION_PATTERN.test(configPath)) {
    return [];
  }
  const base = configPath.replace(CONFIG_EXTENSION_PATTERN, "");
  return Object.values(SHADER_LANGUAGES).flatMap((language) =>
    language.extensions.map((extension) => `${base}.${extension}`));
}

/** Prefix marking a buffer's vertex-shader companion pass key. */
export const VERTEX_PASS_PREFIX = "__shader_studio_vertex__:";

/** Encodes a buffer's vertex-shader companion pass key. */
export function vertexPassKey(passName: string): string {
  return `${VERTEX_PASS_PREFIX}${passName}`;
}

/** Decodes a vertex-shader companion pass key, or undefined for other names. */
export function parseVertexPassKey(key: string): string | undefined {
  return key.startsWith(VERTEX_PASS_PREFIX) ? key.slice(VERTEX_PASS_PREFIX.length) : undefined;
}

/** Only lowercase `common` is a Common pass. Any other spelling (notably
 * `Common`) is an ordinary buffer name: the renderer compiles it as a pass
 * while nothing prepends it as Common source. */
export function isCommonPassName(name: string): boolean {
  return name === "common";
}

/** Derives a pass's authoring stage. A vertex-suffixed source file is always
 * the vertex stage, even when the pass entry says otherwise; otherwise a
 * compute-typed pass is compute and everything else is fragment. */
export function stageForPass(config: ShaderConfig | null, passName: string, path: string): ShaderStage {
  if (/\.(?:vert|vs)$/i.test(path)) {
    return "vertex";
  }
  const pass = config?.passes?.[passName];
  return pass && "type" in pass && pass.type === "compute" ? "compute" : "fragment";
}

/** Derives a pass's authoring resources: texture inputs by slot, then storage. */
export function resourcesForPass(config: ShaderConfig | null, passName: string): AuthoringResource[] {
  const pass = config?.passes?.[passName];
  const inputs = pass && "inputs" in pass ? pass.inputs : undefined;
  const resources: AuthoringResource[] = Object.entries(inputs ?? {}).map(([name, input], slot) => ({
    name,
    kind: input.type === "cubemap" ? "texture-cube" : "texture-2d",
    slot,
  }));
  for (const [name, storage] of Object.entries(config?.storage ?? {})) {
    resources.push({ name, kind: "storage", elementType: storage.elementType });
  }
  return resources;
}

/** Path operations the shared configured-path resolver needs from its host.
 * Node hosts use `path`, the standalone virtual workspace uses posix string
 * operations, and the corpus harness uses `path` against fixture roots. */
export interface ConfiguredPathHost {
  workspaceRootFor(anchorPath: string): string | undefined;
  joinPath(base: string, ...segments: string[]): string;
  dirnameOf(path: string): string;
  normalizePath(path: string): string;
  isAbsolutePath(path: string): boolean;
}

/** Resolves a path written in a `.sha.json` config to an absolute path.
 *
 * `@/` resolves against the workspace root containing the config (falling
 * back to the config's own directory); absolute paths normalize; everything
 * else resolves against the config's directory — never the shader's. The
 * config owns the reference, so the config directory is canonical: the two
 * only agree while the config is the shader's sibling. */
export function resolveConfiguredPath(
  host: ConfiguredPathHost,
  configPath: string,
  configuredPath: string,
): string {
  if (configuredPath.startsWith("@/")) {
    const root = host.workspaceRootFor(configPath) ?? host.dirnameOf(configPath);
    return host.normalizePath(host.joinPath(root, configuredPath.slice(2)));
  }
  if (host.isAbsolutePath(configuredPath)) {
    return host.normalizePath(configuredPath);
  }
  return host.normalizePath(host.joinPath(host.dirnameOf(configPath), configuredPath));
}
