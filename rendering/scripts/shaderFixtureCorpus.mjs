import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Plain node with no transform: the ESM distributions have extensionless
// relative imports, so load the CommonJS distributions. Run the workspace
// builds before the corpus suites so these never go stale.
const { resolveConfiguredPath, VERTEX_PASS_PREFIX } = createRequire(import.meta.url)("@shader-studio/types");
const { resolveSlangIncludes, resolveSlangImports } = createRequire(import.meta.url)("@shader-studio/utils");

const CONFIG_SUFFIX = ".sha.json";
const TEXT_EXTENSIONS = new Set([".glsl", ".slang", ".wgsl"]);

/** @param {string} directory @returns {string[]} */
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git") {
      return [];
    }
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

/** @param {string} root @returns {import("@shader-studio/types").ConfiguredPathHost} */
function fixturePathHost(root) {
  return {
    workspaceRootFor: () => root,
    joinPath: (...segments) => path.join(...segments),
    dirnameOf: (value) => path.dirname(value),
    normalizePath: (value) => path.normalize(value),
    isAbsolutePath: (value) => path.isAbsolute(value),
  };
}

// Configured paths resolve against the owning config's directory (the
// canonical rule in `resolveConfiguredPath`), not the shader's. Corpus
// configs are always siblings of their shaders, so the anchor change is a
// no-op on current fixtures; the step 7 parity test pins the agreement.
/** @param {string} root @param {string} configPath @param {string} fixturePath */
function resolveFixturePath(root, configPath, fixturePath) {
  return resolveConfiguredPath(fixturePathHost(root), configPath, fixturePath);
}

/** @param {string} filePath */
function readSource(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

// The production Slang resolver: includes first, then imports, exactly as
// the extension host prepares sources for the Slang WASM compiler. Any
// fixture the old regex inliner accepted but production rejects (or vice
// versa) shows up as a corpus diff — investigate that, do not restore the
// inliner.
/** @param {string} source @param {string} sourcePath */
function inlineSlangDependencies(source, sourcePath) {
  const withIncludes = resolveSlangIncludes(source, sourcePath, readSource).source;
  return resolveSlangImports(withIncludes, sourcePath, readSource);
}

/** @param {string} filePath */
function mimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".svg": return "image/svg+xml";
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    case ".mp4": return "video/mp4";
    case ".glb": return "model/gltf-binary";
    default: return "application/octet-stream";
  }
}

/** @param {string} filePath */
function dataUrl(filePath) {
  const contents = fs.readFileSync(filePath);
  return `data:${mimeType(filePath)};base64,${contents.toString("base64")}`;
}

/** @param {string | undefined} scriptPath */
function customUniforms(scriptPath) {
  if (!scriptPath) {
    return {};
  }
  if (path.basename(scriptPath) === "custom-uniforms.ts") {
    return {
      customUniformDeclarations: "uniform float uRed;\nuniform float uGreen;\nuniform float uOffset;",
      customUniformInfo: ["uRed", "uGreen", "uOffset"].map((name) => ({ name, type: "float" })),
      customUniformValues: [
        { name: "uRed", type: "float", value: 0.5 },
        { name: "uGreen", type: "float", value: 1 },
        { name: "uOffset", type: "float", value: 0 },
      ],
    };
  }
  return {
    customUniformDeclarations: [
      "uniform float uFloat;",
      "uniform vec2 uVec2;",
      "uniform vec3 uVec3;",
      "uniform vec4 uVec4;",
      "uniform bool uBool;",
    ].join("\n"),
    customUniformInfo: [
      { name: "uFloat", type: "float" },
      { name: "uVec2", type: "vec2" },
      { name: "uVec3", type: "vec3" },
      { name: "uVec4", type: "vec4" },
      { name: "uBool", type: "bool" },
    ],
    customUniformValues: [
      { name: "uFloat", type: "float", value: 0.5 },
      { name: "uVec2", type: "vec2", value: [0.5, 1] },
      { name: "uVec3", type: "vec3", value: [0.5, 0.933, 0.067] },
      { name: "uVec4", type: "vec4", value: [1, 0.25, 0.85, 0.5] },
      { name: "uBool", type: "bool", value: true },
    ],
  };
}

/** @param {string} root @param {string} configPath @param {string} shaderPath */
function buildProject(root, configPath, shaderPath) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const extension = path.extname(shaderPath);
  const language = extension === ".slang" ? "slang" : extension === ".wgsl" ? "wgsl" : "glsl";
  /** @type {Record<string, string>} */
  const buffers = {};
  /** @type {Record<string, string>} */
  const sourcePaths = {};

  for (const [passName, pass] of Object.entries(config.passes ?? {})) {
    if (pass?.path) {
      const passPath = resolveFixturePath(root, configPath, pass.path);
      const passSource = readSource(passPath);
      if (passSource !== null) {
        buffers[passName] = language === "slang"
          ? inlineSlangDependencies(passSource, passPath)
          : passSource;
        sourcePaths[passName] = passPath;
      }
    }
    if (pass?.vertex) {
      const vertexPath = resolveFixturePath(root, configPath, pass.vertex);
      const vertexSource = readSource(vertexPath);
      if (vertexSource !== null) {
        buffers[`${VERTEX_PASS_PREFIX}${passName}`] = language === "slang"
          ? inlineSlangDependencies(vertexSource, vertexPath)
          : vertexSource;
      }
    }
    if (pass?.geometry?.type === "model" && pass.geometry.path) {
      const modelPath = resolveFixturePath(root, configPath, pass.geometry.path);
      if (fs.existsSync(modelPath)) {
        pass.geometry.resolved_path = dataUrl(modelPath);
      }
    }
    for (const input of Object.values(pass?.inputs ?? {})) {
      if (!input?.path || input.type === "buffer" || input.type === "keyboard") {
        continue;
      }
      const assetPath = resolveFixturePath(root, configPath, input.path);
      if (fs.existsSync(assetPath)) {
        input.resolved_path = dataUrl(assetPath);
      }
    }
  }

  const rootSource = fs.readFileSync(shaderPath, "utf8");
  return {
    name: path.relative(root, shaderPath),
    path: shaderPath,
    language,
    image: language === "slang" ? inlineSlangDependencies(rootSource, shaderPath) : rootSource,
    config,
    buffers,
    slangSourcePath: language === "slang" ? shaderPath : undefined,
    slangSourcePaths: language === "slang" ? sourcePaths : undefined,
    ...customUniforms(config.script),
  };
}

/** @param {string} root */
export function loadShaderFixtureCorpus(root) {
  if (!fs.existsSync(root)) {
    throw new Error(`Shader fixture corpus not found at ${root}`);
  }
  return walk(root)
    .filter((filePath) => filePath.endsWith(CONFIG_SUFFIX))
    .flatMap((configPath) => {
      const shaderStem = configPath.slice(0, -CONFIG_SUFFIX.length);
      return [".slang", ".glsl", ".wgsl"]
        .map((extension) => `${shaderStem}${extension}`)
        .filter((shaderPath) => fs.existsSync(shaderPath) && TEXT_EXTENSIONS.has(path.extname(shaderPath)))
        .map((shaderPath) => buildProject(root, configPath, shaderPath));
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
