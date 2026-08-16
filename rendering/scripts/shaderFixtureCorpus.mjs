import fs from "node:fs";
import path from "node:path";

const CONFIG_SUFFIX = ".sha.json";
const TEXT_EXTENSIONS = new Set([".glsl", ".slang"]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git") {
      return [];
    }
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

function resolveFixturePath(root, ownerPath, fixturePath) {
  if (fixturePath.startsWith("@/")) {
    return path.join(root, fixturePath.slice(2));
  }
  return path.resolve(path.dirname(ownerPath), fixturePath);
}

function readSource(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function inlineSlangDependencies(source, sourcePath, visited = new Set()) {
  const resolveDependency = (requestedPath, original) => {
    const dependencyPath = path.resolve(path.dirname(sourcePath), requestedPath);
    if (visited.has(dependencyPath)) {
      return original;
    }
    const dependency = readSource(dependencyPath);
    if (dependency === null) {
      return original;
    }
    visited.add(dependencyPath);
    return inlineSlangDependencies(dependency, dependencyPath, visited)
      .replace(/^\s*module\s+[A-Za-z_]\w*\s*;\s*/m, "")
      .replace(/^\s*implementing\s+[A-Za-z_]\w*\s*;\s*/m, "");
  };

  const withIncludes = source.replace(
    /^\s*(?:#include|__include)\s+"([^"]+)"\s*;?\s*$/gm,
    (original, requestedPath) => resolveDependency(requestedPath, original),
  );

  return withIncludes.replace(
    /^\s*(?:__exported\s+)?import\s+("([^"]+)"|([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*))\s*;?\s*$/gm,
    (original, _import, quotedPath, moduleName) => {
      if (moduleName === "shader_studio" || moduleName === "shader-studio") {
        return original;
      }
      const requestedPath = quotedPath
        ?? `${moduleName.replace(/\./g, path.sep).replace(/_/g, "-")}.slang`;
      return resolveDependency(requestedPath, original);
    },
  );
}

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

function dataUrl(filePath) {
  const contents = fs.readFileSync(filePath);
  return `data:${mimeType(filePath)};base64,${contents.toString("base64")}`;
}

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

function buildProject(root, configPath, shaderPath) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const language = path.extname(shaderPath) === ".slang" ? "slang" : "glsl";
  const buffers = {};
  const sourcePaths = {};

  for (const [passName, pass] of Object.entries(config.passes ?? {})) {
    if (pass?.path) {
      const passPath = resolveFixturePath(root, shaderPath, pass.path);
      const passSource = readSource(passPath);
      if (passSource !== null) {
        buffers[passName] = language === "slang"
          ? inlineSlangDependencies(passSource, passPath)
          : passSource;
        sourcePaths[passName] = passPath;
      }
    }
    if (pass?.vertex) {
      const vertexPath = resolveFixturePath(root, shaderPath, pass.vertex);
      const vertexSource = readSource(vertexPath);
      if (vertexSource !== null) {
        buffers[`__shader_studio_vertex__:${passName}`] = language === "slang"
          ? inlineSlangDependencies(vertexSource, vertexPath)
          : vertexSource;
      }
    }
    if (pass?.geometry?.type === "model" && pass.geometry.path) {
      const modelPath = resolveFixturePath(root, shaderPath, pass.geometry.path);
      if (fs.existsSync(modelPath)) {
        pass.geometry.resolved_path = dataUrl(modelPath);
      }
    }
    for (const input of Object.values(pass?.inputs ?? {})) {
      if (!input?.path || input.type === "buffer" || input.type === "keyboard") {
        continue;
      }
      const assetPath = resolveFixturePath(root, shaderPath, input.path);
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

export function loadShaderFixtureCorpus(root) {
  if (!fs.existsSync(root)) {
    throw new Error(`Shader fixture corpus not found at ${root}`);
  }
  return walk(root)
    .filter((filePath) => filePath.endsWith(CONFIG_SUFFIX))
    .flatMap((configPath) => {
      const shaderStem = configPath.slice(0, -CONFIG_SUFFIX.length);
      return [".slang", ".glsl"]
        .map((extension) => `${shaderStem}${extension}`)
        .filter((shaderPath) => fs.existsSync(shaderPath) && TEXT_EXTENSIONS.has(path.extname(shaderPath)))
        .map((shaderPath) => buildProject(root, configPath, shaderPath));
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
