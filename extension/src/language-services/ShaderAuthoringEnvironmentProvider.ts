import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  isAuthoringValueType,
  type AuthoringResource,
  type CustomUniformDeclaration,
  type ShaderAuthoringEnvironment,
  type ShaderConfig,
  type ShaderStage,
} from "@shader-studio/types";
import { collectSlangDependencies, resolveSlangIncludes } from "../app/SlangDependencyGraph";

const customUniforms = new Map<string, readonly CustomUniformDeclaration[]>();
const snapshotListeners = new Set<(shaderPath: string) => void>();
const loadedShaderProjects = new Map<string, { config: ShaderConfig; configPath: string; shaderPath: string }>();
const projectSnapshotListeners = new Set<() => void>();
type AuthoringDocument = Pick<vscode.TextDocument, "uri" | "languageId" | "getText">;

/** Makes the exact project configuration sent to an active Shader Studio client available to authoring services. */
export function publishLoadedShaderProjectSnapshot(shaderPath: string, config: ShaderConfig): void {
  const normalizedShaderPath = path.resolve(shaderPath);
  const previous = loadedShaderProjects.get(normalizedShaderPath);
  loadedShaderProjects.delete(normalizedShaderPath);
  loadedShaderProjects.set(normalizedShaderPath, {
    config: JSON.parse(JSON.stringify(config)) as ShaderConfig,
    configPath: shaderPath.replace(/\.(?:glsl|frag|vert|comp|slang)$/i, ".sha.json"),
    shaderPath: normalizedShaderPath,
  });
  // Every shaderSource message republishes the snapshot, so only a genuinely
  // different project reanalyses open documents.
  if (JSON.stringify(previous?.config) !== JSON.stringify(config)) {
    notifyProjectSnapshotListeners();
  }
}

export function clearLoadedShaderProjectSnapshots(): void {
  const hadSnapshots = loadedShaderProjects.size > 0;
  loadedShaderProjects.clear();
  if (hadSnapshots) {
    notifyProjectSnapshotListeners();
  }
}

function notifyProjectSnapshotListeners(): void {
  for (const listener of projectSnapshotListeners) {
    listener();
  }
}

/** Fires when the configured passes, inputs, or storage backing authoring change. */
export function onDidChangeLoadedShaderProjectSnapshot(listener: () => void): vscode.Disposable {
  projectSnapshotListeners.add(listener);
  return { dispose: () => projectSnapshotListeners.delete(listener) };
}

/** Shares trusted ScriptEvaluator type snapshots without exposing values or code. */
export function publishCustomUniformSnapshot(shaderPath: string, values: readonly { name: string; type: string }[]): void {
  customUniforms.set(path.resolve(shaderPath), values.flatMap(({ name, type }) => isAuthoringValueType(type) ? [{ name, type }] : []));
  for (const listener of snapshotListeners) {
    listener(shaderPath);
  }
}

export function clearCustomUniformSnapshot(shaderPath: string): void {
  customUniforms.delete(path.resolve(shaderPath));
  for (const listener of snapshotListeners) {
    listener(shaderPath);
  }
}

export function onDidChangeCustomUniformSnapshot(listener: (shaderPath: string) => void): vscode.Disposable {
  snapshotListeners.add(listener);
  return { dispose: () => snapshotListeners.delete(listener) };
}

export class ShaderAuthoringEnvironmentProvider {
  private readonly generations = new Map<string, { fingerprint: string; generation: number }>();

  environmentFor(document: AuthoringDocument): ShaderAuthoringEnvironment | undefined {
    const languageId = document.languageId === "slang" ? "slang" : document.languageId === "glsl" ? "glsl" : undefined;
    if (!languageId) {
      return undefined;
    }
    const loadedConfig = readConfig(document.uri.fsPath);
    const config = loadedConfig?.config ?? null;
    const pass = findPass(config, document.uri.fsPath, loadedConfig?.path);
    const stage = pass && "vertex" in pass && pass.vertex ? "vertex" : stageFor(document.uri.fsPath, pass?.value);
    const resources = resourcesFor(config, pass?.value);
    const uniforms = customUniforms.get(path.resolve(mainShaderPath(document.uri.fsPath, languageId, loadedConfig?.path))) ?? [];
    const outputLayers = pass?.value && "type" in pass.value && pass.value.type === "compute"
      ? pass.value.outputLayers ?? 1
      : undefined;
    const passName = pass?.name ?? "Image";
    const commonFile = configuredCommonFile(config, loadedConfig?.path, passName);
    const virtualFiles = mergeVirtualFiles(
      collectVirtualFiles(document.getText(), document.uri.fsPath, languageId, passName),
      commonFile ? collectVirtualFiles(commonFile.text, vscode.Uri.parse(commonFile.uri).fsPath, languageId, "common") : [],
    );
    const semantic = { languageId, passName, stage, outputLayers, resources, uniforms, commonFile, virtualFiles };
    const fingerprint = JSON.stringify(semantic);
    const current = this.generations.get(document.uri.toString());
    const generation = current?.fingerprint === fingerprint ? current.generation : (current?.generation ?? 0) + 1;
    this.generations.set(document.uri.toString(), { fingerprint, generation });
    return {
      documentUri: document.uri.toString(),
      languageId,
      generation,
      passName: semantic.passName,
      stage,
      outputLayers,
      customUniforms: uniforms,
      resources,
      commonFile,
      virtualFiles,
    };
  }
}

function configuredCommonFile(
  config: ShaderConfig | null,
  configPath: string | undefined,
  passName: string,
): { uri: string; text: string; version: number } | undefined {
  if (!config || !configPath || passName.toLowerCase() === "common") {
    return undefined;
  }
  const passes = config.passes as ShaderConfig["passes"] & Record<string, ShaderConfig["passes"][string]>;
  const common = passes.common ?? passes.Common;
  if (!common || !("path" in common) || !common.path) {
    return undefined;
  }
  const commonPath = resolveConfiguredPath(configPath, common.path);
  const openDocument = vscode.workspace.textDocuments.find((document) => (
    path.normalize(document.uri.fsPath) === path.normalize(commonPath)
  ));
  try {
    return {
      uri: vscode.Uri.file(commonPath).toString(),
      text: openDocument?.getText() ?? fs.readFileSync(commonPath, "utf8"),
      version: openDocument?.version ?? 1,
    };
  } catch {
    return undefined;
  }
}

function resolveConfiguredPath(configPath: string, configuredPath: string): string {
  if (configuredPath.startsWith("@/")) {
    const workspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(configPath));
    return path.resolve(workspace?.uri.fsPath ?? path.dirname(configPath), configuredPath.slice(2));
  }
  return path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(path.dirname(configPath), configuredPath);
}

function mergeVirtualFiles(
  ...groups: readonly { uri: string; text: string; version: number }[][]
): { uri: string; text: string; version: number }[] {
  return [...new Map(groups.flat().map((file) => [file.uri, file])).values()];
}

function readConfig(shaderPath: string): { config: ShaderConfig; path: string } | null {
  const companion = shaderPath.replace(/\.(?:glsl|frag|vert|comp|slang)$/i, ".sha.json");
  const direct = parseConfig(companion);
  if (direct) {
    return direct;
  }
  const loaded = findLoadedShaderProject(shaderPath);
  if (loaded) {
    return { config: loaded.config, path: loaded.configPath };
  }
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(shaderPath))?.uri.fsPath;
  const searchRoot = path.resolve(workspaceRoot ?? path.parse(shaderPath).root);
  let directory = path.dirname(path.resolve(shaderPath));
  while (isWithinDirectory(searchRoot, directory)) {
    try {
      const candidates = fs.readdirSync(directory)
        .filter((name) => name.endsWith(".sha.json"))
        .map((name) => path.join(directory, name))
        .filter((candidate) => candidate !== companion)
        .sort();
      for (const candidate of candidates) {
        const loaded = parseConfig(candidate);
        if (loaded && findExplicitPass(loaded.config, shaderPath, loaded.path)) {
          return loaded;
        }
      }
    } catch { /* unavailable directory */ }
    if (directory === searchRoot) {
      break;
    }
    directory = path.dirname(directory);
  }
  return null;
}

function findLoadedShaderProject(shaderPath: string) {
  const normalizedShaderPath = path.resolve(shaderPath);
  const projects = [...loadedShaderProjects.values()].reverse();
  return projects.find((project) => (
    project.shaderPath === normalizedShaderPath
    || Boolean(findExplicitPass(project.config, normalizedShaderPath, project.configPath))
  ));
}

function isWithinDirectory(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function parseConfig(configPath: string): { config: ShaderConfig; path: string } | null {
  const openDocument = vscode.workspace.textDocuments.find((document) => (
    document.uri.scheme === "file" && path.normalize(document.uri.fsPath) === path.normalize(configPath)
  ));
  if (openDocument) {
    try {
      return { config: JSON.parse(openDocument.getText()) as ShaderConfig, path: configPath };
    } catch {
      // Keep authoring available while an in-progress edit temporarily leaves the config invalid.
    }
  }
  try {
    return { config: JSON.parse(fs.readFileSync(configPath, "utf8")) as ShaderConfig, path: configPath };
  } catch {
    return null;
  }
}

function findPass(config: ShaderConfig | null, shaderPath: string, configPath?: string) {
  if (!config) {
    return undefined;
  }
  return findExplicitPass(config, shaderPath, configPath) ?? { name: "Image", value: config.passes.Image };
}

function findExplicitPass(config: ShaderConfig, shaderPath: string, configPath?: string) {
  const resolved = path.resolve(shaderPath);
  const owningConfigPath = configPath ?? shaderPath;
  for (const [name, value] of Object.entries(config.passes)) {
    if (!value) {
      continue;
    }
    if ("path" in value && value.path && resolveConfiguredPath(owningConfigPath, value.path) === resolved) {
      return { name, value };
    }
    if ("vertex" in value && value.vertex && resolveConfiguredPath(owningConfigPath, value.vertex) === resolved) {
      return { name, value, vertex: true };
    }
  }
  return undefined;
}

function stageFor(shaderPath: string, pass: ShaderConfig["passes"][string]): ShaderStage {
  if (/\.(?:vert|vs)$/i.test(shaderPath)) {
    return "vertex";
  }
  return pass && "type" in pass && pass.type === "compute" ? "compute" : "fragment";
}

function resourcesFor(config: ShaderConfig | null, pass: ShaderConfig["passes"][string]): AuthoringResource[] {
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

function mainShaderPath(documentPath: string, language: "glsl" | "slang", configPath?: string): string {
  return configPath?.replace(/\.sha\.json$/i, language === "slang" ? ".slang" : ".glsl") ?? documentPath;
}

function collectVirtualFiles(
  source: string,
  ownerPath: string,
  language: "glsl" | "slang",
  passName: string,
): { uri: string; text: string; version: number }[] {
  const files = new Map<string, { uri: string; text: string; version: number }>();
  const readSource = (filePath: string): string | null => {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  };
  if (language === "slang") {
    const dependencies = collectSlangDependencies({ rootPath: ownerPath, rootSource: source, ownerPass: passName, readSource });
    for (const module of dependencies.modules) {
      files.set(module.path, { uri: vscode.Uri.file(module.path).toString(), text: module.source, version: 1 });
    }
    const includes = resolveSlangIncludes(source, ownerPath, readSource).includedPaths;
    for (const includePath of includes) {
      const text = readSource(includePath);
      if (text !== null) {
        files.set(includePath, { uri: vscode.Uri.file(includePath).toString(), text, version: 1 });
      }
    }
    return [...files.values()];
  }
  const visit = (text: string, currentPath: string) => {
    for (const match of text.matchAll(/^\s*#include\s+"([^"]+)"/gm)) {
      if (!match[1]) {
        continue;
      }
      const includePath = path.resolve(path.dirname(currentPath), match[1]);
      if (files.has(includePath)) {
        continue;
      }
      try {
        const includeText = readSource(includePath);
        if (includeText === null) {
          continue;
        }
        files.set(includePath, { uri: vscode.Uri.file(includePath).toString(), text: includeText, version: 1 });
        visit(includeText, includePath);
      } catch { /* service diagnostics report missing files */ }
    }
  };
  visit(source, ownerPath);
  return [...files.values()];
}
