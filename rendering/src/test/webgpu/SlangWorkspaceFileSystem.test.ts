import { describe, expect, it } from "vitest";
import { normalizeInternalPath, releaseWorkspaceFileSystem, syncWorkspaceToFileSystem, type SlangFileSystem } from "../../webgpu/SlangWorkspaceFileSystem";

class MemoryFileSystem implements SlangFileSystem {
  files = new Map<string, string>();
  directories = new Set<string>();
  fail?: "mkdir" | "write" | "unlink";
  failPath?: string;
  readFailPath?: string;
  mkdirTree(path: string) {
    if (this.fail === "mkdir") {
      throw new Error("mkdir");
    }
    this.directories.add(path);
  }
  writeFile(path: string, source: string | Uint8Array) {
    if (this.fail === "write") {
      throw new Error("write");
    }
    this.files.set(path, typeof source === "string" ? source : new TextDecoder().decode(source));
  }
  readFile(path: string) { if (this.readFailPath === path) throw new Error("read"); const source = this.files.get(path); if (source === undefined) throw new Error("read"); return source; }
  unlink(path: string) {
    if (this.fail === "unlink" || this.failPath === path) {
      throw new Error("unlink");
    }
    this.files.delete(path);
  }
  analyzePath(path: string) {
    return { exists: this.files.has(path) || this.directories.has(path) };
  }
}
const snapshot = (files: Array<{ path: string; source: string }>) => ({
  rootUri: "file:///root.slang",
  files: files.map((file, index) => ({ ...file, uri: `file:///${index}` })),
});

describe("SlangWorkspaceFileSystem", () => {
  it("normalizes separators and dots but rejects normalized workspace escapes", () => {
    expect(normalizeInternalPath("\\workspace\\dir\\.\\file.slang")).toBe("/workspace/dir/file.slang");
    expect(normalizeInternalPath("/workspace/a/../file.slang")).toBe("/workspace/file.slang");
    expect(() => normalizeInternalPath("workspace/file.slang")).toThrow(/absolute/);
    expect(() => normalizeInternalPath("/workspace/../outside.slang")).toThrow(/workspace/);
  });
  it("syncs deterministically and removes only stale owned paths", () => {
    const fs = new MemoryFileSystem();
    const owned = new Set<string>(["/workspace/stale.slang"]);
    fs.files.set("/workspace/stale.slang", "old");
    fs.files.set("/workspace/user.slang", "keep");
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a/../main.slang", source: "new" }]), owned);
    expect(fs.files).toEqual(new Map([["/workspace/user.slang", "keep"], ["/workspace/main.slang", "new"]]));
    expect(owned).toEqual(new Set(["/workspace/main.slang"]));
    expect(fs.directories).toContain("/workspace");
  });
  it("updates existing files and creates nested parent directories", () => {
    const fs = new MemoryFileSystem(); const owned = new Set<string>();
    fs.files.set("/workspace/nested/main.slang", "old");
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/nested/main.slang", source: "new" }]), owned);
    expect(fs.files.get("/workspace/nested/main.slang")).toBe("new");
    expect(fs.directories).toContain("/workspace/nested");
  });
  it("prevalidates all paths before mutating and rejects conflicting duplicates", () => {
    const fs = new MemoryFileSystem();
    const owned = new Set<string>();
    expect(() => syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a", source: "a" }, { path: "/outside", source: "b" }]), owned)).toThrow();
    expect(fs.files.size).toBe(0);
    expect(() => syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a", source: "a" }, { path: "/workspace/./a", source: "b" }]), owned)).toThrow(/duplicate/i);
  });
  it("rejects the workspace mount as a file before mutating filesystem or ownership", () => {
    const fs = new MemoryFileSystem();
    const owned = new Set<string>(["/workspace/owned.slang"]);
    fs.files.set("/workspace/owned.slang", "owned");
    fs.directories.add("/workspace");

    expect(() => syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a/..", source: "bad" }]), owned)).toThrow(/file path/);
    expect(fs.files).toEqual(new Map([["/workspace/owned.slang", "owned"]]));
    expect(fs.directories).toEqual(new Set(["/workspace"]));
    expect(owned).toEqual(new Set(["/workspace/owned.slang"]));
  });
  it("accepts identical normalized duplicates deterministically", () => {
    const fs = new MemoryFileSystem(); const owned = new Set<string>();
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a", source: "same" }, { path: "/workspace/./a", source: "same" }]), owned);
    expect(fs.files).toEqual(new Map([["/workspace/a", "same"]]));
  });
  it.each(["mkdir", "write", "unlink"] as const)("retries a failed %s sync without touching unrelated files", (failure) => {
    const fs = new MemoryFileSystem();
    const owned = new Set<string>(["/workspace/old"]);
    fs.files.set("/workspace/old", "old");
    fs.fail = failure;
    fs.files.set("/workspace/user", "keep");
    expect(() => syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/new", source: "new" }]), owned)).toThrow(failure);
    expect(owned).toEqual(new Set(["/workspace/old", "/workspace/new"]));
    expect(fs.files.get("/workspace/user")).toBe("keep");

    fs.fail = undefined;
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/new", source: "new" }]), owned);
    expect(fs.files).toEqual(new Map([["/workspace/user", "keep"], ["/workspace/new", "new"]]));
    expect(owned).toEqual(new Set(["/workspace/new"]));
  });
  it("hands off active ownership and releases only the active owner once", () => {
    const fs = new MemoryFileSystem();
    const first = new Set<string>();
    const second = new Set<string>();
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/old", source: "old" }]), first);
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/new", source: "new" }]), second);
    expect(first.size).toBe(0);
    expect(fs.files.has("/workspace/old")).toBe(false);
    releaseWorkspaceFileSystem(fs, first);
    expect(fs.files.has("/workspace/new")).toBe(true);
    releaseWorkspaceFileSystem(fs, second);
    releaseWorkspaceFileSystem(fs, second);
    expect(fs.files.size).toBe(0);
  });
  it("rolls back B-only writes when a cross-owner stale unlink fails", () => {
    const fs = new MemoryFileSystem();
    const a = new Set<string>(); const b = new Set<string>();
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a", source: "a" }]), a);
    fs.failPath = "/workspace/a";
    expect(() => syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/b", source: "b" }]), b)).toThrow("unlink");
    expect(fs.files).toEqual(new Map([["/workspace/a", "a"]]));
    fs.failPath = undefined;
    releaseWorkspaceFileSystem(fs, b);
    releaseWorkspaceFileSystem(fs, a);
    expect(fs.files.size).toBe(0);
  });
  it("restores overwritten common and previously deleted stale files after cross-owner failure", () => {
    const fs = new MemoryFileSystem(); const a = new Set<string>(); const b = new Set<string>();
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/common", source: "A" }, { path: "/workspace/stale", source: "old" }]), a);
    fs.failPath = "/workspace/stale";
    expect(() => syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/common", source: "B" }, { path: "/workspace/b", source: "only-b" }]), b)).toThrow();
    expect(fs.files).toEqual(new Map([["/workspace/common", "A"], ["/workspace/stale", "old"]]));
    expect(a).toEqual(new Set(["/workspace/common", "/workspace/stale"]));
    fs.failPath = undefined; releaseWorkspaceFileSystem(fs, b); releaseWorkspaceFileSystem(fs, a);
    expect(fs.files.size).toBe(0);
  });
  it("restores partially deleted stale files in insertion order after a later unlink fails", () => {
    const fs = new MemoryFileSystem(); const a = new Set<string>(); const b = new Set<string>();
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/stale1", source: "one" }, { path: "/workspace/stale2", source: "two" }]), a);
    fs.failPath = "/workspace/stale2";
    expect(() => syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/b", source: "b" }]), b)).toThrow();
    expect(fs.files).toEqual(new Map([["/workspace/stale1", "one"], ["/workspace/stale2", "two"]]));
    expect(a).toEqual(new Set(["/workspace/stale1", "/workspace/stale2"]));
    fs.failPath = undefined; releaseWorkspaceFileSystem(fs, b); releaseWorkspaceFileSystem(fs, a);
    expect(fs.files.size).toBe(0);
  });
  it("aborts on journal read failure before any mutation or ownership handoff", () => {
    const fs = new MemoryFileSystem(); const a = new Set<string>(); const b = new Set<string>();
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a", source: "a" }]), a);
    fs.readFailPath = "/workspace/a";
    expect(() => syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/b", source: "b" }]), b)).toThrow("read");
    expect(fs.files).toEqual(new Map([["/workspace/a", "a"]])); expect(a).toEqual(new Set(["/workspace/a"])); expect(b.size).toBe(0);
    fs.readFailPath = undefined; releaseWorkspaceFileSystem(fs, b); releaseWorkspaceFileSystem(fs, a);
    expect(fs.files.size).toBe(0);
  });
  it("keeps active ownership after a release unlink failure so cleanup can be retried", () => {
    const fs = new MemoryFileSystem();
    const owned = new Set<string>();
    syncWorkspaceToFileSystem(fs, snapshot([{ path: "/workspace/a", source: "a" }, { path: "/workspace/b", source: "b" }]), owned);

    fs.fail = "unlink";
    expect(() => releaseWorkspaceFileSystem(fs, owned)).toThrow("unlink");
    expect(owned).toEqual(new Set(["/workspace/a", "/workspace/b"]));

    fs.fail = undefined;
    releaseWorkspaceFileSystem(fs, owned);
    expect(fs.files.size).toBe(0);
    expect(owned.size).toBe(0);
  });
  it("supports empty snapshots", () => {
    const fs = new MemoryFileSystem();
    const owned = new Set<string>();
    syncWorkspaceToFileSystem(fs, snapshot([]), owned);
    expect(owned.size).toBe(0);
  });
});
