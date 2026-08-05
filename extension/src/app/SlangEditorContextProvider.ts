import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ConfigInput, ShaderConfig } from "@shader-studio/types";
import { PathResolver } from "./PathResolver";
import { ScriptBundler } from "./ScriptBundler";
import { ScriptEvaluator } from "./ScriptEvaluator";
import { isConfigPath } from "./ShaderConfigPaths";
import {
  buildSlangEditorContextModule,
  type SlangEditorChannel,
  type SlangEditorUniform,
} from "./SlangEditorContextModule";

export interface SlangConfigSource {
  filePath: string;
  text: string;
}

export interface ResolvedSlangEditorPassContext {
  config: ShaderConfig;
  configPath: string;
  rootShaderPath: string;
  passName: string;
  channels: SlangEditorChannel[];
}

export interface SlangEditorContextHost {
  findConfigSources(): Promise<SlangConfigSource[]>;
  getWorkspaceFolderPath(uri: vscode.Uri): string | undefined;
  resolveCustomUniforms(
    config: ShaderConfig,
    rootShaderPath: string,
  ): Promise<SlangEditorUniform[]>;
}

interface ResolvePassContextOptions {
  focusedFilePath: string;
  workspaceFolderPath: string | undefined;
  configs: readonly SlangConfigSource[];
}

export class SlangEditorContextProvider {
  constructor(private readonly host: SlangEditorContextHost = new DefaultSlangEditorContextHost()) {}

  public async buildSource(document: vscode.TextDocument): Promise<string> {
    const configs = await this.host.findConfigSources();
    const resolved = resolveSlangEditorPassContext({
      focusedFilePath: document.fileName,
      workspaceFolderPath: this.host.getWorkspaceFolderPath(document.uri),
      configs,
    });
    let customUniforms: SlangEditorUniform[] = [];
    if (resolved) {
      try {
        customUniforms = await this.host.resolveCustomUniforms(
          resolved.config,
          resolved.rootShaderPath,
        );
      } catch {
        customUniforms = [];
      }
    }

    return buildSlangEditorContextModule({
      focusedFileName: document.fileName,
      channels: resolved?.channels ?? [],
      customUniforms,
    });
  }
}

export function resolveSlangEditorPassContext(
  options: ResolvePassContextOptions,
): ResolvedSlangEditorPassContext | undefined {
  const focusedPath = path.normalize(options.focusedFilePath);
  const parsedConfigs = options.configs
    .map(parseConfigSource)
    .filter((entry): entry is ParsedConfigSource => entry !== undefined)
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
  const companionConfigPath = focusedPath.replace(/\.slang$/i, ".sha.json");

  const companion = parsedConfigs.find(
    ({ filePath }) => path.normalize(filePath) === companionConfigPath,
  );
  if (companion) {
    return resolvedContext(companion, "Image", options.workspaceFolderPath);
  }

  for (const config of parsedConfigs) {
    for (const [passName, pass] of Object.entries(config.config.passes)) {
      if (!pass || !("path" in pass) || typeof pass.path !== "string") {
        continue;
      }
      const passPath = resolveAuthoredPath(
        config.rootShaderPath,
        pass.path,
        options.workspaceFolderPath,
      );
      if (path.normalize(passPath) !== focusedPath) {
        continue;
      }
      return resolvedContext(config, passName, options.workspaceFolderPath);
    }
  }

  return undefined;
}

interface ParsedConfigSource extends SlangConfigSource {
  config: ShaderConfig;
  rootShaderPath: string;
}

function parseConfigSource(source: SlangConfigSource): ParsedConfigSource | undefined {
  try {
    const config = JSON.parse(source.text) as ShaderConfig;
    if (!config || typeof config !== "object" || !config.passes || typeof config.passes !== "object") {
      return undefined;
    }
    return {
      ...source,
      config,
      rootShaderPath: source.filePath.replace(/\.sha\.json$/i, ".slang"),
    };
  } catch {
    return undefined;
  }
}

function resolvedContext(
  source: ParsedConfigSource,
  passName: string,
  workspaceFolderPath: string | undefined,
): ResolvedSlangEditorPassContext {
  return {
    config: source.config,
    configPath: source.filePath,
    rootShaderPath: source.rootShaderPath,
    passName,
    channels: passName === "common"
      ? Object.entries(source.config.passes)
        .filter(([name]) => name !== "common")
        .flatMap(([, pass]) => channelsFromInputs(pass?.inputs))
      : channelsFromInputs(source.config.passes[passName]?.inputs),
  };
}

function channelsFromInputs(
  inputs: Record<string, ConfigInput> | undefined,
): SlangEditorChannel[] {
  if (!inputs) {
    return [];
  }
  const validEntries = Object.entries(inputs).filter(([key, input]) => {
    const numericName = /^iChannel(\d+)$/.exec(key);
    return (!numericName || Number.parseInt(numericName[1], 10) <= 15)
      && input !== null
      && typeof input === "object"
      && isChannelKind(input.type);
  });
  return validEntries.slice(0, 16).map(([key, input], slot) => ({
    slot,
    key,
    kind: input.type,
  }));
}

function isChannelKind(value: string): value is SlangEditorChannel["kind"] {
  return ["texture", "video", "cubemap", "audio", "buffer", "keyboard"].includes(value);
}

function resolveAuthoredPath(
  rootShaderPath: string,
  authoredPath: string,
  workspaceFolderPath: string | undefined,
): string {
  if (authoredPath.startsWith("@/") && workspaceFolderPath) {
    return path.resolve(workspaceFolderPath, authoredPath.slice(2));
  }
  return path.resolve(path.dirname(rootShaderPath), authoredPath);
}

class DefaultSlangEditorContextHost implements SlangEditorContextHost {
  public async findConfigSources(): Promise<SlangConfigSource[]> {
    const discovered = await vscode.workspace.findFiles(
      "**/*.sha.json",
      "**/{node_modules,.git}/**",
    );
    const uris = new Map(discovered.map((uri) => [uri.toString(), uri]));
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme === "file" && isConfigPath(document.fileName)) {
        uris.set(document.uri.toString(), document.uri);
      }
    }

    const sources = await Promise.all([...uris.values()].map(async (uri) => ({
      filePath: uri.fsPath,
      text: await readDocumentOrFile(uri),
    })));
    return sources.filter((source): source is SlangConfigSource => source.text !== undefined);
  }

  public getWorkspaceFolderPath(uri: vscode.Uri): string | undefined {
    return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
  }

  public async resolveCustomUniforms(
    config: ShaderConfig,
    rootShaderPath: string,
  ): Promise<SlangEditorUniform[]> {
    if (!config.script || !vscode.workspace.isTrusted) {
      return [];
    }
    const scriptPath = PathResolver.resolvePath(rootShaderPath, config.script);
    const shaderWorkspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(rootShaderPath));
    const scriptWorkspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(scriptPath));
    if (!shaderWorkspace || scriptWorkspace?.uri.fsPath !== shaderWorkspace.uri.fsPath) {
      return [];
    }
    const openScript = vscode.workspace.textDocuments.find(
      (document) => path.normalize(document.uri.fsPath) === path.normalize(scriptPath),
    );
    if (!openScript && !fs.existsSync(scriptPath)) {
      return [];
    }

    const bundle = await new ScriptBundler().bundle(scriptPath, openScript?.getText());
    if (!bundle.success || !bundle.code) {
      return [];
    }
    const evaluator = new ScriptEvaluator();
    try {
      const result = evaluator.loadScript(bundle.code, scriptPath);
      return result.error ? [] : result.uniforms;
    } finally {
      evaluator.dispose();
    }
  }
}

async function readDocumentOrFile(uri: vscode.Uri): Promise<string | undefined> {
  const openDocument = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );
  if (openDocument) {
    return openDocument.getText();
  }
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch {
    return undefined;
  }
}
