import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  SHADER_LANGUAGES,
  configPathForShader,
  isAuthoringValueType,
  isCommonPassName,
  resolveConfiguredPath,
  type ConfiguredPathHost,
  isShaderLanguageId,
  resourcesForPass,
  stageForPass,
  type AuthoringResource,
  type CustomUniformDeclaration,
  type ShaderAuthoringEnvironment,
  type ShaderConfig,
  type ShaderLanguageId,
  type ShaderStage,
} from "@shader-studio/types";
import { collectSlangDependencies, resolveSlangIncludes } from "@shader-studio/utils";

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
    configPath: configPathForShader(shaderPath),
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
    const languageId = isShaderLanguageId(document.languageId) ? document.languageId : undefined;
    if (!languageId) {
      return undefined;
    }
    const loadedConfig = readConfig(document.uri.fsPath);
    const config = loadedConfig?.config ?? null;
    const pass = findPass(config, document.uri.fsPath, loadedConfig?.path);
    const stage = pass && "vertex" in pass && pass.vertex ? "vertex" : stageForPass(config, pass?.name ?? "Image", document.uri.fsPath);
    const resources = resourcesForPass(config, pass?.name ?? "Image");
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

  /**
   * Supplies independent shader documents for workspace symbol operations.
   * This is intentionally opt-in: completions and diagnostics should not pay
   * for a workspace scan on every keystroke.
   */
  async workspaceEnvironmentFor(document: AuthoringDocument): Promise<ShaderAuthoringEnvironment | undefined> {
    const environment = this.environmentFor(document);
    if (!environment) {
      return undefined;
    }
    return { ...environment, workspaceDocuments: await this.workspaceDocumentsFor(document, environment.languageId) };
  }

  async workspaceSnapshotIsCurrent(document: AuthoringDocument, environment: ShaderAuthoringEnvironment): Promise<boolean> {
    if (!environment.workspaceDocuments) {
      return true;
    }
    const current = await this.workspaceDocumentsFor(document, environment.languageId);
    return JSON.stringify(current) === JSON.stringify(environment.workspaceDocuments);
  }

  private async workspaceDocumentsFor(document: AuthoringDocument, languageId: ShaderLanguageId): Promise<NonNullable<ShaderAuthoringEnvironment["workspaceDocuments"]>> {
    const uris = await vscode.workspace.findFiles(workspaceShaderGlob(languageId), "**/{node_modules,.git}/**");
    const byUri = new Map(uris.map((uri) => [uri.toString(), uri]));
    byUri.set(document.uri.toString(), document.uri);
    const result: { uri: string; text: string; version: number; stage: ShaderStage; commonUri?: string }[] = [];
    for (const uri of [...byUri.values()].sort((left, right) => left.toString().localeCompare(right.toString()))) {
      const open = uri.toString() === document.uri.toString()
        ? document
        : vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString())
          ?? { uri, languageId, getText: () => fs.readFileSync(uri.fsPath, "utf8") };
      const candidate = this.environmentFor(open);
      if (!candidate || candidate.languageId !== languageId) {
        continue;
      }
      const version = "version" in open && typeof open.version === "number" ? open.version : 1;
      result.push({ uri: uri.toString(), text: open.getText(), version, stage: candidate.stage, commonUri: candidate.commonFile?.uri });
    }
    return result;
  }
}

export function workspaceShaderGlob(languageId: ShaderLanguageId): string {
  const extensions = SHADER_LANGUAGES[languageId].extensions;
  return extensions.length === 1 ? `**/*.${extensions[0]}` : `**/*.{${extensions.join(",")}}`;
}

function configuredCommonFile(
  config: ShaderConfig | null,
  configPath: string | undefined,
  passName: string,
): { uri: string; text: string; version: number } | undefined {
  if (!config || !configPath || isCommonPassName(passName)) {
    return undefined;
  }
  const passes = config.passes as ShaderConfig["passes"] & Record<string, ShaderConfig["passes"][string]>;
  const common = passes.common;
  if (!common || !("path" in common) || !common.path) {
    return undefined;
  }
  const commonPath = resolveConfiguredPath(configuredPathHost, configPath, common.path);
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

const configuredPathHost: ConfiguredPathHost = {
  workspaceRootFor: (anchorPath) =>
    vscode.workspace.getWorkspaceFolder(vscode.Uri.file(anchorPath))?.uri.fsPath,
  joinPath: (...segments) => path.join(...segments),
  dirnameOf: (value) => path.dirname(value),
  normalizePath: (value) => path.normalize(value),
  isAbsolutePath: (value) => path.isAbsolute(value),
};

function mergeVirtualFiles(
  ...groups: readonly { uri: string; text: string; version: number }[][]
): { uri: string; text: string; version: number }[] {
  return [...new Map(groups.flat().map((file) => [file.uri, file])).values()];
}

function readConfig(shaderPath: string): { config: ShaderConfig; path: string } | null {
  const companion = configPathForShader(shaderPath);
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
    if ("path" in value && value.path && resolveConfiguredPath(configuredPathHost, owningConfigPath, value.path) === resolved) {
      return { name, value };
    }
    if ("vertex" in value && value.vertex && resolveConfiguredPath(configuredPathHost, owningConfigPath, value.vertex) === resolved) {
      return { name, value, vertex: true };
    }
  }
  return undefined;
}

function mainShaderPath(documentPath: string, language: ShaderLanguageId, configPath?: string): string {
  return configPath?.replace(/\.sha\.json$/i, `.${SHADER_LANGUAGES[language].extensions[0]}`) ?? documentPath;
}

function collectVirtualFiles(
  source: string,
  ownerPath: string,
  language: ShaderLanguageId,
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
  if (SHADER_LANGUAGES[language].hasImports) {
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
