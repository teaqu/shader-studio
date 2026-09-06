import { dirname, isAbsolute, join, normalize, parse, relative, resolve } from "pathe";
import * as vscode from "vscode";
import {
  isAuthoringValueType,
  type AuthoringResource,
  type CustomUniformDeclaration,
  type ShaderAuthoringEnvironment,
  type ShaderConfig,
  type ShaderStage,
} from "@shader-studio/types";
import { collectSlangDependenciesAsync, resolveSlangIncludesAsync } from "../app/SlangDependencyGraph";

const customUniforms = new Map<string, readonly CustomUniformDeclaration[]>();
const snapshotListeners = new Set<(shaderPath: string) => void>();
const loadedShaderProjects = new Map<string, { config: ShaderConfig; configPath: string; shaderPath: string }>();
const projectSnapshotListeners = new Set<() => void>();
type AuthoringDocument = Pick<vscode.TextDocument, "uri" | "languageId" | "getText">;

/** Makes the exact project configuration sent to an active Shader Studio client available to authoring services. */
export function publishLoadedShaderProjectSnapshot(shaderPath: string, config: ShaderConfig): void {
  const normalizedShaderPath = resolve(shaderPath);
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
  customUniforms.set(resolve(shaderPath), values.flatMap(({ name, type }) => isAuthoringValueType(type) ? [{ name, type }] : []));
  for (const listener of snapshotListeners) {
    listener(shaderPath);
  }
}

export function clearCustomUniformSnapshot(shaderPath: string): void {
  customUniforms.delete(resolve(shaderPath));
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

  async environmentFor(document: AuthoringDocument): Promise<ShaderAuthoringEnvironment | undefined> {
    const languageId = document.languageId === "slang" ? "slang" : document.languageId === "glsl" ? "glsl" : undefined;
    if (!languageId) {
      return undefined;
    }
    const loadedConfig = await readConfig(document.uri.fsPath);
    const config = loadedConfig?.config ?? null;
    const pass = findPass(config, document.uri.fsPath, loadedConfig?.path);
    const stage = pass && "vertex" in pass && pass.vertex ? "vertex" : stageFor(document.uri.fsPath, pass?.value);
    const resources = resourcesFor(config, pass?.value);
    const uniforms = customUniforms.get(resolve(mainShaderPath(document.uri.fsPath, languageId, loadedConfig?.path))) ?? [];
    const outputLayers = pass?.value && "type" in pass.value && pass.value.type === "compute"
      ? pass.value.outputLayers ?? 1
      : undefined;
    const passName = pass?.name ?? "Image";
    const commonFile = await configuredCommonFile(config, loadedConfig?.path, passName);
    const virtualFiles = mergeVirtualFiles(
      await collectVirtualFiles(document.getText(), document.uri.fsPath, languageId, passName),
      commonFile ? await collectVirtualFiles(commonFile.text, vscode.Uri.parse(commonFile.uri).fsPath, languageId, "common") : [],
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

/**
 * Reads a file through the workspace file system so this works on desktop and
 * in the browser extension host, where Node `fs` does not exist. Open editors
 * are preferred by callers; this is the on-disk fallback for unopened files.
 * Returns null when the file cannot be read (missing, non-file scheme, …).
 */
async function readTextFile(filePath: string): Promise<string | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    // TextDecoder — not Node's Buffer — so this also runs in the browser
    // extension host, where Buffer does not exist.
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
}

/** Lists sibling `.sha.json` names in a directory, sorted, or [] when unreadable. */
async function listConfigNames(directory: string): Promise<string[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(directory));
    return entries
      .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".sha.json"))
      .map(([name]) => name)
      .sort();
  } catch {
    return [];
  }
}

async function configuredCommonFile(
  config: ShaderConfig | null,
  configPath: string | undefined,
  passName: string,
): Promise<{ uri: string; text: string; version: number } | undefined> {
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
    normalize(document.uri.fsPath) === normalize(commonPath)
  ));
  try {
    const text = openDocument?.getText() ?? await readTextFile(commonPath);
    if (text === null || text === undefined) {
      return undefined;
    }
    return {
      uri: vscode.Uri.file(commonPath).toString(),
      text,
      version: openDocument?.version ?? 1,
    };
  } catch {
    return undefined;
  }
}

function resolveConfiguredPath(configPath: string, configuredPath: string): string {
  if (configuredPath.startsWith("@/")) {
    const workspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(configPath));
    return resolve(workspace?.uri.fsPath ?? dirname(configPath), configuredPath.slice(2));
  }
  return isAbsolute(configuredPath)
    ? normalize(configuredPath)
    : resolve(dirname(configPath), configuredPath);
}

function mergeVirtualFiles(
  ...groups: readonly { uri: string; text: string; version: number }[][]
): { uri: string; text: string; version: number }[] {
  return [...new Map(groups.flat().map((file) => [file.uri, file])).values()];
}

async function readConfig(shaderPath: string): Promise<{ config: ShaderConfig; path: string } | null> {
  const companion = shaderPath.replace(/\.(?:glsl|frag|vert|comp|slang)$/i, ".sha.json");
  const direct = await parseConfig(companion);
  if (direct) {
    return direct;
  }
  const loaded = findLoadedShaderProject(shaderPath);
  if (loaded) {
    return { config: loaded.config, path: loaded.configPath };
  }
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(shaderPath))?.uri.fsPath;
  const searchRoot = resolve(workspaceRoot ?? parse(shaderPath).root);
  let directory = dirname(resolve(shaderPath));
  while (isWithinDirectory(searchRoot, directory)) {
    try {
      const candidates = (await listConfigNames(directory))
        .map((name) => join(directory, name))
        .filter((candidate) => candidate !== companion)
        .sort();
      for (const candidate of candidates) {
        const loaded = await parseConfig(candidate);
        if (loaded && findExplicitPass(loaded.config, shaderPath, loaded.path)) {
          return loaded;
        }
      }
    } catch { /* unavailable directory */ }
    if (directory === searchRoot) {
      break;
    }
    directory = dirname(directory);
  }
  return null;
}

function findLoadedShaderProject(shaderPath: string) {
  const normalizedShaderPath = resolve(shaderPath);
  const projects = [...loadedShaderProjects.values()].reverse();
  return projects.find((project) => (
    project.shaderPath === normalizedShaderPath
    || Boolean(findExplicitPass(project.config, normalizedShaderPath, project.configPath))
  ));
}

function isWithinDirectory(parent: string, candidate: string): boolean {
  const candidateRelative = relative(parent, candidate);
  return candidateRelative === "" || (!candidateRelative.startsWith("../") && candidateRelative !== ".." && !isAbsolute(candidateRelative));
}

async function parseConfig(configPath: string): Promise<{ config: ShaderConfig; path: string } | null> {
  const openDocument = vscode.workspace.textDocuments.find((document) => (
    document.uri.scheme === "file" && normalize(document.uri.fsPath) === normalize(configPath)
  ));
  if (openDocument) {
    try {
      return { config: JSON.parse(openDocument.getText()) as ShaderConfig, path: configPath };
    } catch {
      // Keep authoring available while an in-progress edit temporarily leaves the config invalid.
    }
  }
  try {
    const text = await readTextFile(configPath);
    if (text === null) {
      return null;
    }
    return { config: JSON.parse(text) as ShaderConfig, path: configPath };
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
  const resolved = resolve(shaderPath);
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

async function collectVirtualFiles(
  source: string,
  ownerPath: string,
  language: "glsl" | "slang",
  passName: string,
): Promise<{ uri: string; text: string; version: number }[]> {
  const files = new Map<string, { uri: string; text: string; version: number }>();
  const readSource = (filePath: string): Promise<string | null> => readTextFile(filePath);
  if (language === "slang") {
    const dependencies = await collectSlangDependenciesAsync({ rootPath: ownerPath, rootSource: source, ownerPass: passName, readSource });
    for (const module of dependencies.modules) {
      files.set(module.path, { uri: vscode.Uri.file(module.path).toString(), text: module.source, version: 1 });
    }
    const includes = (await resolveSlangIncludesAsync(source, ownerPath, readSource)).includedPaths;
    for (const includePath of includes) {
      const text = await readSource(includePath);
      if (text !== null) {
        files.set(includePath, { uri: vscode.Uri.file(includePath).toString(), text, version: 1 });
      }
    }
    return [...files.values()];
  }
  const visit = async (text: string, currentPath: string): Promise<void> => {
    for (const match of text.matchAll(/^\s*#include\s+"([^"]+)"/gm)) {
      if (!match[1]) {
        continue;
      }
      const includePath = resolve(dirname(currentPath), match[1]);
      if (files.has(includePath)) {
        continue;
      }
      try {
        const includeText = await readSource(includePath);
        if (includeText === null) {
          continue;
        }
        files.set(includePath, { uri: vscode.Uri.file(includePath).toString(), text: includeText, version: 1 });
        await visit(includeText, includePath);
      } catch { /* service diagnostics report missing files */ }
    }
  };
  await visit(source, ownerPath);
  return [...files.values()];
}
