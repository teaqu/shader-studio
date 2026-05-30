import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
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

      // Backfill metadata for uncommitted moves: if an untracked file has the same
      // basename as a working-tree-deleted file, inherit the deleted file's metadata.
      let statusOutput = "";
      try {
        statusOutput = await this.runGit(["-C", repoRoot, "status", "--porcelain"]);
      } catch { /* ignore */ }

      const deletedByBasename = ShaderGitMetadataProvider.parseDeletedShadersByBasename(statusOutput);
      for (const currentPath of currentPaths) {
        if (!metadata[currentPath]) {
          const basename = currentPath.split("/").pop()!;
          const deletedPath = deletedByBasename.get(basename);
          if (deletedPath && metadata[deletedPath]) {
            metadata[currentPath] = { ...metadata[deletedPath] };
          }
        }
      }

      metadata = pruneMetadata(metadata, currentPaths);
      cache.repos[repoRoot] = { head, metadata };
      this.writeCache(cache);

      let dirtyPaths: Set<string>;
      try {
        dirtyPaths = ShaderGitMetadataProvider.parseDirtyPaths(statusOutput);
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
          metadataByPath.set(normalizedPath, { ...existing, modifiedTime: currentCommitTime });
        }
      } else if (existing.createdTime === undefined || currentCommitTime < existing.createdTime) {
        metadataByPath.set(normalizedPath, { ...existing, createdTime: currentCommitTime });
      }
    }

    return metadataByPath;
  }

  public static parseGitLogCreated(output: string): Map<string, ShaderGitMetadata> {
    const metadataByPath = new Map<string, ShaderGitMetadata>();
    const renameMap = new Map<string, string>(); // old path → current path
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

      const parts = line.split("\t");
      const statusCode = parts[0];

      if (statusCode.startsWith("R") && parts.length >= 3) {
        const oldPath = normalizePath(parts[1]);
        const newPath = normalizePath(parts[2]);
        const currentPath = resolveCurrentPath(newPath, renameMap);
        renameMap.set(oldPath, currentPath);
      } else if (statusCode === "A" && parts.length >= 2) {
        const addedPath = normalizePath(parts[1]);
        const currentPath = resolveCurrentPath(addedPath, renameMap);
        const existing = metadataByPath.get(currentPath) ?? {};
        if (existing.createdTime === undefined || currentCommitTime < existing.createdTime) {
          metadataByPath.set(currentPath, { ...existing, createdTime: currentCommitTime });
        }
      }
    }

    return metadataByPath;
  }

  public static parseDeletedShadersByBasename(output: string): Map<string, string> {
    const deletedByBasename = new Map<string, string>();
    for (const rawLine of output.split(/\r?\n/)) {
      if (rawLine.length < 4) {
        continue;
      }
      const xy = rawLine.slice(0, 2);
      if (xy === "??" || !xy.includes("D")) {
        continue;
      }
      const rawPath = rawLine.slice(3).trim();
      const filePath = normalizePath(rawPath);
      if (/\.(glsl|frag|vert)$/.test(filePath)) {
        const basename = filePath.split("/").pop()!;
        if (!deletedByBasename.has(basename)) {
          deletedByBasename.set(basename, filePath);
        }
      }
    }
    return deletedByBasename;
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

  private static async defaultGitRunner(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, { maxBuffer: MAX_GIT_BUFFER });
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
      "-C", repoRoot, "log", "--format=commit:%ct", "--name-only", "--", ...SHADER_GLOBS,
    ]);
    const createdOutput = await this.runGit([
      "-C", repoRoot, "log", "--format=commit:%ct", "--name-status", "--diff-filter=AR", "--", ...SHADER_GLOBS,
    ]);
    return mergeMetadataMaps(
      ShaderGitMetadataProvider.parseGitLog(modifiedOutput, "modified"),
      ShaderGitMetadataProvider.parseGitLogCreated(createdOutput),
    );
  }

  private async scanIncrementalHistory(
    repoRoot: string,
    cachedRepo: RepoCache,
  ): Promise<Record<string, ShaderGitMetadata>> {
    const metadata = { ...cachedRepo.metadata };
    const range = `${cachedRepo.head}..HEAD`;
    const modifiedOutput = await this.runGit([
      "-C", repoRoot, "log", range, "--format=commit:%ct", "--name-only", "--", ...SHADER_GLOBS,
    ]);
    const createdOutput = await this.runGit([
      "-C", repoRoot, "log", range, "--format=commit:%ct", "--name-status", "--diff-filter=AR", "--", ...SHADER_GLOBS,
    ]);

    // Transfer cached metadata for any files renamed in the new commits
    const renames = parseRenameMap(createdOutput);
    for (const [oldPath, newPath] of renames) {
      if (metadata[oldPath]) {
        const existing = metadata[newPath] ?? {};
        metadata[newPath] = {
          createdTime: minimumDefined(existing.createdTime, metadata[oldPath].createdTime),
          modifiedTime: maximumDefined(existing.modifiedTime, metadata[oldPath].modifiedTime),
        };
      }
    }

    mergeIntoRecord(metadata, ShaderGitMetadataProvider.parseGitLog(modifiedOutput, "modified"));
    mergeIntoRecord(metadata, ShaderGitMetadataProvider.parseGitLogCreated(createdOutput));
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

  public clearCache(): void {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        fs.unlinkSync(this.cacheFilePath);
      }
    } catch (error) {
      this.logGitMetadataWarning(error);
    }
  }

  private readCache(): CacheFile {
    try {
      if (!fs.existsSync(this.cacheFilePath)) {
        return createEmptyCache();
      }
      const parsed = JSON.parse(fs.readFileSync(this.cacheFilePath, "utf8")) as CacheFile;
      if (!parsed.repos) {
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
  return { repos: {} };
}

function parseRenameMap(output: string): Map<string, string> {
  const renameMap = new Map<string, string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("commit:")) {
      continue;
    }
    const parts = line.split("\t");
    if (parts[0].startsWith("R") && parts.length >= 3) {
      const oldPath = normalizePath(parts[1]);
      const newPath = normalizePath(parts[2]);
      renameMap.set(oldPath, resolveCurrentPath(newPath, renameMap));
    }
  }
  return renameMap;
}

function resolveCurrentPath(filePath: string, renameMap: Map<string, string>): string {
  let current = filePath;
  const visited = new Set<string>();
  while (renameMap.has(current) && !visited.has(current)) {
    visited.add(current);
    current = renameMap.get(current)!;
  }
  return current;
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
