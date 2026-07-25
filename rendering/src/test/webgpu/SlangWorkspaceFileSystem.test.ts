import { describe, expect, it } from "vitest";
import { normalizeInternalPath, releaseWorkspaceFileSystem, syncWorkspaceToFileSystem, type SlangFileSystem } from "../../webgpu/SlangWorkspaceFileSystem";

class MemoryFileSystem implements SlangFileSystem {
  files = new Map<string, string>(); directories = new Set<string>(); fail?: "mkdir" | "write" | "unlink";
  mkdirTree(path: string) {
    if (this.fail === "mkdir") {
      throw new Error("mkdir");
    }
    this.directories.add(path);
  }
  writeFile(path: string, source: string) {
    if (this.fail === "write") {
      throw new Error("write");
    }
    this.files.set(path, source);
  }
  unlink(path: string) {
    if (this.fail === "unlink") {
      throw new Error("unlink");
    }
    this.files.delete(path);
  }
  analyzePath(path: string) {
    return { exists: this.files.has(path) || this.directories.has(path) };
  }
}
const snapshot = (files: Array<{ path: string; source: string }>) => ({ rootUri: "file:///root.slang", files: files.map((file, index) => ({ ...file, uri: `file:///${index}` })) });

describe("SlangWorkspaceFileSystem", () => {
  it("normalizes separators and dots but rejects normalized workspace escapes", () => {
    expect(normalizeInternalPath("\\workspace\\dir\\.\\file.slang")).toBe("/workspace/dir/file.slang");
    expect(normalizeInternalPath("/workspace/a/../file.slang")).toBe("/workspace/file.slang");
    expect(() => normalizeInternalPath("workspace/file.slang")).toThrow(/absolute/);
    expect(() => normalizeInternalPath("/workspace/../outside.slang")).toThrow(/workspace/);
  });
  it("syncs deterministically and removes only stale owned paths", () => {
    const fs = new MemoryFileSystem(); const owned = new Set<string>(["/workspace/stale.slang"]);
    fs.files.set("/workspace/stale.slang", "old"); fs.files.set("/workspace/user.slang", "keep");
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a/../main.slang", source: "new" }]), owned);
    expect(fs.files).toEqual(new Map([["/workspace/user.slang", "keep"], ["/workspace/main.slang", "new"]]));
    expect(owned).toEqual(new Set(["/workspace/main.slang"])); expect(fs.directories).toContain("/workspace");
  });
  it("updates existing files and creates nested parent directories", () => {
    const fs = new MemoryFileSystem(); const owned = new Set<string>();
    fs.files.set("/workspace/nested/main.slang", "old");
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/nested/main.slang", source: "new" }]), owned);
    expect(fs.files.get("/workspace/nested/main.slang")).toBe("new");
    expect(fs.directories).toContain("/workspace/nested");
  });
  it("prevalidates all paths before mutating and rejects conflicting duplicates", () => {
    const fs = new MemoryFileSystem(); const owned = new Set<string>();
    expect(() => syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a", source: "a" }, { path: "/outside", source: "b" }]), owned)).toThrow();
    expect(fs.files.size).toBe(0);
    expect(() => syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a", source: "a" }, { path: "/workspace/./a", source: "b" }]), owned)).toThrow(/duplicate/i);
  });
  it("accepts identical normalized duplicates deterministically", () => {
    const fs = new MemoryFileSystem(); const owned = new Set<string>();
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a", source: "same" }, { path: "/workspace/./a", source: "same" }]), owned);
    expect(fs.files).toEqual(new Map([["/workspace/a", "same"]]));
  });
  it.each(["mkdir", "write", "unlink"] as const)("retains retryable ownership after failed %s", (failure) => {
    const fs = new MemoryFileSystem(); const owned = new Set<string>(["/workspace/old"]); fs.files.set("/workspace/old", "old"); fs.fail = failure;
    fs.files.set("/workspace/user", "keep");
    expect(() => syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/new", source: "new" }]), owned)).toThrow(failure);
    expect(owned).toEqual(new Set(["/workspace/old", "/workspace/new"]));
    expect(fs.files.get("/workspace/user")).toBe("keep");
  });
  it("hands off active ownership and releases only the active owner once", () => {
    const fs = new MemoryFileSystem(); const first = new Set<string>(); const second = new Set<string>();
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/old", source: "old" }]), first);
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/new", source: "new" }]), second);
    expect(first.size).toBe(0); expect(fs.files.has("/workspace/old")).toBe(false);
    releaseWorkspaceFileSystem(fs, first); expect(fs.files.has("/workspace/new")).toBe(true);
    releaseWorkspaceFileSystem(fs, second); releaseWorkspaceFileSystem(fs, second); expect(fs.files.size).toBe(0);
  });
  it("supports empty snapshots", () => {
    const fs = new MemoryFileSystem(); const owned = new Set<string>(); syncWorkspaceToFileSystem(fs, snapshot([]), owned); expect(owned.size).toBe(0);
  });
});
