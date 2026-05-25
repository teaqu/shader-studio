import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const CACHE_VERSION = 1;
const MAX_GIT_BUFFER = 10 * 1024 * 1024;
const SHADER_GLOBS = ["*.glsl", "*.frag", "*.vert"];

export interface ShaderGitMetadata {
  createdTime?: number;
  modifiedTime?: number;
}

export interface ShaderGitMetadataResult {
  repoRoot: string;
  metadataByPath: Map<string, ShaderGitMetadata>;
  dirtyPaths: Set<string>;
}

export type GitCommandRunner = (args: string[]) => Promise<string>;

interface RepoCache {
  head: string;
  metadata: Record<string, ShaderGitMetadata>;
}

interface CacheFile {
  version: number;
  repos: Record<string, RepoCache>;
}

type GitLogMode = "created" | "modified";

export class ShaderGitMetadataProvider {
  private readonly cacheDir: string;
  private readonly cacheFilePath: string;

  constructor(
    context: vscode.ExtensionContext,
    private readonly runGit: GitCommandRunner = ShaderGitMetadataProvider.defaultGitRunner,
  ) {
    this.cacheDir = path.join(context.globalStorageUri.fsPath, "shader-git-metadata");
    this.cacheFilePath = path.join(this.cacheDir, "cache.json");
  }

  public async getMetadataForWorkspace(
    workspaceRoot: string,
    shaderPaths: string[],
  ): Promise<ShaderGitMetadataResult | null> {
    try {
      const repoRoot = normalizePath(
        (await this.runGit(["-C", workspaceRoot, "rev-parse", "--show-toplevel"])).trim(),
      );
      const head = (await this.runGit(["-C", repoRoot, "rev-parse", "HEAD"])).trim();
      const currentPaths = this.getCurrentRepoRelativePaths(repoRoot, shaderPaths);
      const cache = this.readCache();
      const cachedRepo = cache.repos[repoRoot];

      let metadata: Record<string, ShaderGitMetadata>;
      if (!cachedRepo) {
        metadata = await this.scanFullHistory(repoRoot);
      } else if (cachedRepo.head === head) {
        metadata = { ...cachedRepo.metadata };
      } else if (await this.isAncestor(repoRoot, cachedRepo.head)) {
        metadata = await this.scanIncrementalHistory(repoRoot, cachedRepo);
      } else {
        metadata = await this.scanFullHistory(repoRoot);
      }

      metadata = pruneMetadata(metadata, currentPaths);
      cache.repos[repoRoot] = {
        head,
        metadata,
      };
      this.writeCache(cache);

      let dirtyPaths: Set<string>;
      try {
        dirtyPaths = await this.getDirtyShaderPaths(repoRoot);
      } catch {
        dirtyPaths = new Set();
      }

      return {
        repoRoot,
        metadataByPath: new Map(Object.entries(metadata)),
        dirtyPaths,
      };
    } catch (error) {
      this.logGitMetadataWarning(error);
      return null;
    }
  }

  public static parseGitLog(output: string, mode: GitLogMode): Map<string, ShaderGitMetadata> {
    const metadataByPath = new Map<string, ShaderGitMetadata>();
    let currentCommitTime: number | undefined;

    for (const rawLine of output.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      if (line.startsWith("commit:")) {
        const parsedTime = Number(line.slice("commit:".length));
        currentCommitTime = Number.isFinite(parsedTime) ? parsedTime * 1000 : undefined;
        continue;
      }

      if (currentCommitTime === undefined) {
        continue;
      }

      const normalizedPath = normalizePath(line);
      const existing = metadataByPath.get(normalizedPath) ?? {};
      if (mode === "modified") {
        if (existing.modifiedTime === undefined || currentCommitTime > existing.modifiedTime) {
          metadataByPath.set(normalizedPath, {
            ...existing,
            modifiedTime: currentCommitTime,
          });
        }
      } else if (existing.createdTime === undefined || currentCommitTime < existing.createdTime) {
        metadataByPath.set(normalizedPath, {
          ...existing,
          createdTime: currentCommitTime,
        });
      }
    }

    return metadataByPath;
  }

  public static parseDirtyPaths(output: string): Set<string> {
    const dirtyPaths = new Set<string>();
    for (const rawLine of output.split(/\r?\n/)) {
      if (rawLine.length < 4) {
        continue;
      }
      const xy = rawLine.slice(0, 2);
      if (xy === "??") {
        continue;
      }
      const rawPath = rawLine.slice(3).trim();
      const renameSep = " -> ";
      const filePath = normalizePath(
        rawPath.includes(renameSep)
          ? rawPath.slice(rawPath.lastIndexOf(renameSep) + renameSep.length)
          : rawPath,
      );
      if (/\.(glsl|frag|vert)$/.test(filePath)) {
        dirtyPaths.add(filePath);
      }
    }
    return dirtyPaths;
  }

  private async getDirtyShaderPaths(repoRoot: string): Promise<Set<string>> {
    const output = await this.runGit(["-C", repoRoot, "status", "--porcelain"]);
    return ShaderGitMetadataProvider.parseDirtyPaths(output);
  }

  private static async defaultGitRunner(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      maxBuffer: MAX_GIT_BUFFER,
    });
    return stdout.toString();
  }

  private async isAncestor(repoRoot: string, cachedHead: string): Promise<boolean> {
    try {
      await this.runGit(["-C", repoRoot, "merge-base", "--is-ancestor", cachedHead, "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  private async scanFullHistory(repoRoot: string): Promise<Record<string, ShaderGitMetadata>> {
    const modifiedOutput = await this.runGit([
      "-C",
      repoRoot,
      "log",
      "--format=commit:%ct",
      "--name-only",
      "--",
      ...SHADER_GLOBS,
    ]);
    const createdOutput = await this.runGit([
      "-C",
      repoRoot,
      "log",
      "--format=commit:%ct",
      "--name-only",
      "--diff-filter=A",
      "--",
      ...SHADER_GLOBS,
    ]);

    return mergeMetadataMaps(
      ShaderGitMetadataProvider.parseGitLog(modifiedOutput, "modified"),
      ShaderGitMetadataProvider.parseGitLog(createdOutput, "created"),
    );
  }

  private async scanIncrementalHistory(
    repoRoot: string,
    cachedRepo: RepoCache,
  ): Promise<Record<string, ShaderGitMetadata>> {
    const metadata = { ...cachedRepo.metadata };
    const modifiedOutput = await this.runGit([
      "-C",
      repoRoot,
      "log",
      `${cachedRepo.head}..HEAD`,
      "--format=commit:%ct",
      "--name-only",
      "--",
      ...SHADER_GLOBS,
    ]);
    const createdOutput = await this.runGit([
      "-C",
      repoRoot,
      "log",
      `${cachedRepo.head}..HEAD`,
      "--format=commit:%ct",
      "--name-only",
      "--diff-filter=A",
      "--",
      ...SHADER_GLOBS,
    ]);

    mergeIntoRecord(metadata, ShaderGitMetadataProvider.parseGitLog(modifiedOutput, "modified"));
    mergeIntoRecord(metadata, ShaderGitMetadataProvider.parseGitLog(createdOutput, "created"));
    return metadata;
  }

  private getCurrentRepoRelativePaths(repoRoot: string, shaderPaths: string[]): Set<string> {
    const currentPaths = new Set<string>();
    for (const shaderPath of shaderPaths) {
      const relativePath = normalizePath(path.relative(repoRoot, shaderPath));
      if (!relativePath.startsWith("../") && relativePath !== "..") {
        currentPaths.add(relativePath);
      }
    }
    return currentPaths;
  }

  private readCache(): CacheFile {
    try {
      if (!fs.existsSync(this.cacheFilePath)) {
        return createEmptyCache();
      }

      const parsed = JSON.parse(fs.readFileSync(this.cacheFilePath, "utf8")) as CacheFile;
      if (parsed.version !== CACHE_VERSION || !parsed.repos) {
        return createEmptyCache();
      }
      return parsed;
    } catch {
      return createEmptyCache();
    }
  }

  private writeCache(cache: CacheFile): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(cache, null, 2), "utf8");
    } catch (error) {
      this.logGitMetadataWarning(error);
    }
  }

  private logGitMetadataWarning(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Shader git metadata unavailable: ${message}`);
  }
}

function createEmptyCache(): CacheFile {
  return {
    version: CACHE_VERSION,
    repos: {},
  };
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function mergeMetadataMaps(
  modifiedMetadata: Map<string, ShaderGitMetadata>,
  createdMetadata: Map<string, ShaderGitMetadata>,
): Record<string, ShaderGitMetadata> {
  const merged: Record<string, ShaderGitMetadata> = {};
  mergeIntoRecord(merged, modifiedMetadata);
  mergeIntoRecord(merged, createdMetadata);
  return merged;
}

function mergeIntoRecord(
  target: Record<string, ShaderGitMetadata>,
  source: Map<string, ShaderGitMetadata>,
): void {
  for (const [shaderPath, metadata] of source.entries()) {
    const existing = target[shaderPath] ?? {};
    target[shaderPath] = {
      createdTime: minimumDefined(existing.createdTime, metadata.createdTime),
      modifiedTime: maximumDefined(existing.modifiedTime, metadata.modifiedTime),
    };
  }
}

function pruneMetadata(
  metadata: Record<string, ShaderGitMetadata>,
  currentPaths: Set<string>,
): Record<string, ShaderGitMetadata> {
  const pruned: Record<string, ShaderGitMetadata> = {};
  for (const [shaderPath, shaderMetadata] of Object.entries(metadata)) {
    if (currentPaths.has(shaderPath)) {
      pruned[shaderPath] = shaderMetadata;
    }
  }
  return pruned;
}

function maximumDefined(left?: number, right?: number): number | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Math.max(left, right);
}

function minimumDefined(left?: number, right?: number): number | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Math.min(left, right);
}
