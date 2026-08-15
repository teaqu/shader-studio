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

  environmentFor(document: vscode.TextDocument): ShaderAuthoringEnvironment | undefined {
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
    const semantic = { languageId, passName: pass?.name ?? "Image", stage, outputLayers, resources, uniforms };
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
      virtualFiles: collectVirtualFiles(document.getText(), document.uri.fsPath, languageId, semantic.passName),
    };
  }
}

function readConfig(shaderPath: string): { config: ShaderConfig; path: string } | null {
  const candidates = [shaderPath.replace(/\.(?:glsl|frag|vert|comp|slang)$/i, ".sha.json")];
  const directory = path.dirname(shaderPath);
  try {
    candidates.push(...fs.readdirSync(directory).filter((name) => name.endsWith(".sha.json")).map((name) => path.join(directory, name)));
  } catch { /* untitled or unavailable directory */ }
  for (const candidate of [...new Set(candidates)]) {
    try {
      return { config: JSON.parse(fs.readFileSync(candidate, "utf8")) as ShaderConfig, path: candidate };
    } catch { /* try next config */ }
  }
  return null;
}

function findPass(config: ShaderConfig | null, shaderPath: string, configPath?: string) {
  if (!config) {
    return undefined;
  }
  const resolved = path.resolve(shaderPath);
  const configDirectory = path.dirname(configPath ?? shaderPath);
  for (const [name, value] of Object.entries(config.passes)) {
    if (!value) {
      continue;
    }
    if ("path" in value && value.path && path.resolve(configDirectory, value.path) === resolved) {
      return { name, value };
    }
    if ("vertex" in value && value.vertex && path.resolve(configDirectory, value.vertex) === resolved) {
      return { name, value, vertex: true };
    }
  }
  return { name: "Image", value: config.passes.Image };
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
