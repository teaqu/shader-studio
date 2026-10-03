import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".svelte"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "out", "coverage", ".svelte-kit", "test", "tests", "__tests__"]);
const PACKAGE_IMPORT = /^(@shader-studio\/[^/]+|shader-studio-ui|shader-explorer-ui|shader-studio)(\/.*)?$/;

// These are architectural constraints, rather than inferred rules: package
// manifests are allowed to express every other intentional dependency.
const FORBIDDEN_IMPORTS = new Map([
  ["@shader-studio/types", "*"],
  ["@shader-studio/utils", new Set(["shader-studio-ui", "@shader-studio/rendering", "shader-studio"])],
  ["@shader-studio/language-server-core", new Set(["shader-studio-ui", "@shader-studio/rendering", "shader-studio"])],
  ["@shader-studio/rendering", new Set(["shader-studio-ui", "shader-studio"])],
  ["shader-studio-ui", new Set(["shader-studio"])],
  ["shader-studio", new Set(["shader-studio-ui"])],
]);

// Foundation packages may only depend on lower-level foundations. This is
// checked against manifests as well as source imports so adding a dependency
// cannot pre-authorise a later layering violation.
const FOUNDATION_DEPENDENCIES = new Map([
  ["@shader-studio/types", new Set()],
  ["@shader-studio/utils", new Set(["@shader-studio/types"])],
  ["@shader-studio/language-server-core", new Set(["@shader-studio/types"])],
]);

// Worker entry points are intentionally published subpaths: the UI creates
// them with `new Worker(new URL(..., import.meta.url))`, while each language
// server's package root is its node-facing API. Keep this allow-list exact.
const PUBLIC_ENTRY_POINT_EXCEPTIONS = new Set([
  "@shader-studio/glsl-language-server/worker",
  "@shader-studio/wgsl-language-server/worker",
]);

// These integration points predate package builds. Each is intentionally
// named so a new deep link cannot hide among the existing migration debt.
const RELATIVE_CROSS_PACKAGE_EXCEPTIONS = new Set([
  "standalone/vite.config.ts:../ui/viteSlangAssetManifest",
  "ui/src/lib/AudioVideoController.ts:../../../rendering/src/types",
  "ui/src/lib/EditorOverlayManager.svelte.ts:../../../rendering/src/types/RenderingEngine",
  "ui/src/lib/PerformanceMonitor.ts:../../../rendering/src/types/RenderingEngine",
  "ui/src/lib/PixelInspectorManager.ts:../../../rendering/src/types",
  "ui/src/lib/PixelInspectorManager.ts:../../../rendering/src/util/TimeManager",
  "ui/src/lib/ScriptRuntimeReporter.ts:../../../rendering/src/types/RenderingEngine",
  "ui/src/lib/ShaderPipeline.ts:../../../rendering/src/types/RenderingEngine",
  "ui/src/lib/ShaderProcessor.ts:../../../rendering/src/types/RenderingEngine",
  "ui/src/lib/VariableCaptureManager.ts:../../../rendering/src/types/RenderingEngine",
  "ui/src/lib/VariableCaptureManager.ts:../../../rendering/src/capture/VariableCapturer",
  "ui/src/lib/VariableCaptureManager.ts:../../../rendering/src/capture/CaptureDecoder",
  "ui/src/lib/VariableCaptureManager.ts:../../../rendering/src/capture/captureDiagnostics",
  "ui/src/lib/VariableCaptureManager.ts:../../../rendering/src/capture/CaptureErrorLog",
  "ui/src/lib/VariableCaptureManager.ts:../../../rendering/src/util/CompilerErrorDedupe",
  "ui/src/lib/components/ShaderViewer.svelte:../../../../rendering/src/types/RenderingEngine",
  "ui/src/lib/components/config/BufferConfig.svelte:../../../../../rendering/src/preview3d/GltfMeshLoader",
  "ui/src/lib/components/debug/DebugPanel.svelte:../../../../../rendering/src/models/PassUniforms",
  "ui/src/lib/components/performance/PerformancePanel.svelte:../../../../../rendering/src/types/RenderingEngine",
  "ui/src/lib/engineFactory.ts:../../../rendering/src/webgl/RenderingEngine",
  "ui/src/lib/engineFactory.ts:../../../rendering/src/webgpu/WebGPURenderingEngine",
  "ui/src/lib/engineFactory.ts:../../../rendering/src/types/RenderingEngine",
  "ui/src/lib/recording/ShaderRecorder.ts:../../../../rendering/src/types/RenderingEngine",
  "ui/src/lib/slangAssets.ts:../../../rendering/src/webgpu/slangCompileWorker.ts?worker&url",
  "ui/src/lib/slangAssets.ts:../../../rendering/src/webgpu/WebGPURenderingEngine",
  "ui/src/lib/util/BufferPathResolver.ts:../../../../rendering/src/types/RenderingEngine",
  "ui/src/lib/util/BufferUpdater.ts:../../../../rendering/src/types/RenderingEngine",
  "shader-explorer/src/lib/components/ShaderPreview.svelte:../../../../rendering/src/types/RenderingEngine",
  "shader-explorer/src/lib/engineFactory.ts:../../../rendering/src/webgl/RenderingEngine",
  "shader-explorer/src/lib/engineFactory.ts:../../../rendering/src/webgpu/WebGPURenderingEngine",
  "shader-explorer/src/lib/engineFactory.ts:../../../rendering/src/types/RenderingEngine",
  "shader-explorer/src/lib/slangAssets.ts:../../../rendering/src/webgpu/WebGPURenderingEngine",
]);

function workspaceDirectories(root) {
  return [
    "types", "standalone", "debug", "rendering", "utils", "extension", "ui", "shader-explorer", "monaco",
    ...readdirSync(join(root, "language-servers"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join("language-servers", entry.name)),
  ];
}

function readPackages(root) {
  const packages = new Map();
  for (const directory of workspaceDirectories(root)) {
    const path = join(root, directory);
    const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
    packages.set(manifest.name, { directory, manifest });
  }
  return packages;
}

function sourceFiles(directory) {
  const files = [];
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          visit(join(path, entry.name));
        }
      } else if (SOURCE_EXTENSIONS.has(extname(entry.name)) && !/(?:\.(?:test|spec|e2e|integration|acceptance|audit|corpus|matrix))\.[^.]+$/.test(entry.name)) {
        files.push(join(path, entry.name));
      }
    }
  };
  visit(directory);
  return files;
}

function sourceText(path) {
  const text = readFileSync(path, "utf8");
  if (extname(path) !== ".svelte") {
    return text;
  }
  return [...text.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join("\n");
}

function isTypeOnlyImport(node) {
  if (ts.isImportDeclaration(node)) {
    return node.importClause?.isTypeOnly === true
      || (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
        && node.importClause.namedBindings.elements.length > 0
        && node.importClause.namedBindings.elements.every((item) => item.isTypeOnly));
  }
  return ts.isExportDeclaration(node) && node.isTypeOnly;
}

function importsIn(path) {
  const source = ts.createSourceFile(path, sourceText(path), ts.ScriptTarget.Latest, true);
  const imports = [];
  const record = (specifier, typeOnly) => {
    if (typeof specifier === "string") {
      imports.push({ specifier, typeOnly });
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier?.text, isTypeOnlyImport(node));
    } else if (ts.isCallExpression(node)) {
      const [firstArgument] = node.arguments;
      const literalArgument = firstArgument && ts.isStringLiteral(firstArgument) ? firstArgument.text : undefined;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        record(literalArgument, false);
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      const [specifier, base] = node.arguments ?? [];
      if (ts.isStringLiteral(specifier)
        && ts.isPropertyAccessExpression(base)
        && ts.isMetaProperty(base.expression)
        && base.name.text === "url") {
        record(specifier.text, false);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function declaredDependencies(manifest) {
  return new Set(Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  }));
}

function isForbiddenDependency(source, target) {
  const allowedFoundationDependencies = FOUNDATION_DEPENDENCIES.get(source);
  if (allowedFoundationDependencies && !allowedFoundationDependencies.has(target)) {
    return true;
  }
  const forbidden = FORBIDDEN_IMPORTS.get(source);
  return forbidden === "*" || forbidden?.has(target) === true;
}

function findCycles(edges) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (node, trail) => {
    if (visiting.has(node)) {
      cycles.push([...trail.slice(trail.indexOf(node)), node]);
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    for (const next of edges.get(node) ?? []) {
      visit(next, [...trail, node]);
    }
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of edges.keys()) {
    visit(node, []);
  }
  return cycles;
}

function resolveLocalImport(sourcePath, specifier, sourcePaths) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  // Vite import suffixes select a loader, rather than changing the source
  // file being imported. Resolve the path without the suffix while retaining
  // the original specifier for diagnostics and exact exceptions.
  const resolutionSpecifier = specifier.replace(/[?#].*$/, "");
  const candidate = resolve(dirname(sourcePath), resolutionSpecifier);
  const candidates = [candidate];
  if (extname(candidate)) {
    candidates.push(candidate.slice(0, -extname(candidate).length));
  }
  for (const base of [...candidates]) {
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(`${base}${extension}`, join(base, `index${extension}`));
    }
  }
  return candidates.find((path) => sourcePaths.has(path));
}

function packageForPath(path, packages, root) {
  for (const [name, { directory }] of packages) {
    const packageRoot = join(root, directory);
    if (path === packageRoot || path.startsWith(`${packageRoot}/`)) {
      return name;
    }
  }
  return undefined;
}

export function checkBoundaries(root) {
  const packages = readPackages(root);
  const errors = [];
  const runtimeEdges = new Map([...packages.keys()].map((name) => [name, new Set()]));
  const filesByPackage = new Map([...packages].map(([name, { directory }]) => [name, sourceFiles(join(root, directory))]));
  const sourcePaths = new Set([...filesByPackage.values()].flat());
  const localRuntimeEdges = new Map([...sourcePaths].map((path) => [path, new Set()]));
  for (const [name, { manifest }] of packages) {
    const dependencies = declaredDependencies(manifest);
    for (const target of dependencies) {
      if (packages.has(target) && isForbiddenDependency(name, target)) {
        errors.push(`${name} may not declare workspace dependency ${target}`);
      }
    }
    for (const path of filesByPackage.get(name)) {
      for (const { specifier, typeOnly } of importsIn(path)) {
        const localTarget = resolveLocalImport(path, specifier, sourcePaths);
        if (localTarget) {
          const targetPackage = packageForPath(localTarget, packages, root);
          if (targetPackage !== name) {
            const exceptionKey = `${relative(root, path)}:${specifier}`;
            if (!RELATIVE_CROSS_PACKAGE_EXCEPTIONS.has(exceptionKey)) {
              errors.push(`${relative(root, path)}: relative import ${specifier} crosses into ${targetPackage}; use its public entry point`);
            }
            if (isForbiddenDependency(name, targetPackage)) {
              errors.push(`${relative(root, path)}: ${name} may not import ${targetPackage}`);
            }
            if (!typeOnly) {
              runtimeEdges.get(name).add(targetPackage);
            }
          }
          if (!typeOnly) {
            localRuntimeEdges.get(path).add(localTarget);
          }
          continue;
        }
        const match = PACKAGE_IMPORT.exec(specifier);
        if (!match || !packages.has(match[1])) {
          continue;
        }
        const target = match[1];
        const display = relative(root, path);
        if (match[2] && !PUBLIC_ENTRY_POINT_EXCEPTIONS.has(specifier)) {
          errors.push(`${display}: import ${specifier}; use ${target}'s public entry point`);
        }
        if (!dependencies.has(target)) {
          errors.push(`${display}: ${name} imports undeclared workspace dependency ${target}`);
        }
        if (isForbiddenDependency(name, target)) {
          errors.push(`${display}: ${name} may not import ${target}`);
        }
        if (!typeOnly && target !== name) {
          runtimeEdges.get(name).add(target);
        }
      }
    }
  }
  for (const cycle of findCycles(runtimeEdges)) {
    errors.push(`runtime workspace dependency cycle: ${cycle.join(" -> ")}`);
  }
  for (const cycle of findCycles(localRuntimeEdges)) {
    errors.push(`runtime module cycle: ${cycle.map((path) => relative(root, path)).join(" -> ")}`);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const errors = checkBoundaries(process.cwd());
  if (errors.length) {
    console.error(`Dependency boundary violations:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    process.exitCode = 1;
  }
}
