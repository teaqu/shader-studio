import { describe, expect, it, vi } from "vitest";
import type { SlangWorkspaceSnapshot } from "../types";
import { syncWorkspaceToFileSystem } from "../virtualFileSystem";

function snapshot(files: SlangWorkspaceSnapshot["files"]): SlangWorkspaceSnapshot {
  return { rootUri: "file:///workspace", files };
}

function fakeFs(existing: string[] = []) {
  const files = new Set(existing);
  return {
    files,
    mkdirTree: vi.fn(),
    writeFile: vi.fn((path: string) => files.add(path)),
    unlink: vi.fn((path: string) => files.delete(path)),
    analyzePath: vi.fn((path: string) => ({ exists: files.has(path) })),
  };
}

describe("syncWorkspaceToFileSystem", () => {
  it("creates parent directories and writes every workspace file", () => {
    const fs = fakeFs();

    syncWorkspaceToFileSystem(fs, snapshot([
      { uri: "file:///workspace/image.slang", path: "/workspace/image.slang", source: "image" },
      { uri: "file:///workspace/lib/a.slang", path: "/workspace/lib/a.slang", source: "a" },
    ]));

    expect(fs.mkdirTree).toHaveBeenCalledWith("/workspace");
    expect(fs.mkdirTree).toHaveBeenCalledWith("/workspace/lib");
    expect(fs.writeFile).toHaveBeenCalledWith("/workspace/image.slang", "image");
    expect(fs.writeFile).toHaveBeenCalledWith("/workspace/lib/a.slang", "a");
  });

  it("uses open documents instead of disk snapshots", () => {
    const fs = fakeFs();
    syncWorkspaceToFileSystem(
      fs,
      snapshot([{ uri: "file:///workspace/a.slang", path: "/workspace/a.slang", source: "disk" }]),
      new Map([["file:///workspace/a.slang", { source: "unsaved", version: 4 }]]),
    );

    expect(fs.writeFile).toHaveBeenCalledWith("/workspace/a.slang", "unsaved");
  });

  it("removes stale files owned by the previous synchronization", () => {
    const fs = fakeFs(["/workspace/old.slang"]);
    const state = new Set(["/workspace/old.slang"]);

    syncWorkspaceToFileSystem(fs, snapshot([]), new Map(), state);

    expect(fs.unlink).toHaveBeenCalledWith("/workspace/old.slang");
    expect(state.size).toBe(0);
  });

  it("does not unlink paths absent from MEMFS", () => {
    const fs = fakeFs();
    const state = new Set(["/workspace/already-gone.slang"]);

    expect(() => syncWorkspaceToFileSystem(fs, snapshot([]), new Map(), state)).not.toThrow();
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it("rejects snapshot paths outside /workspace", () => {
    const fs = fakeFs();

    expect(() => syncWorkspaceToFileSystem(fs, snapshot([
      { uri: "file:///tmp/a.slang", path: "/tmp/a.slang", source: "x" },
    ]))).toThrow("outside the Slang workspace");
  });

  it("never deletes an owned path outside /workspace", () => {
    const fs = fakeFs(["/tmp/user-file.slang"]);
    const state = new Set(["/tmp/user-file.slang"]);

    expect(() => syncWorkspaceToFileSystem(fs, snapshot([]), new Map(), state))
      .toThrow("outside the Slang workspace");
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it("returns the supplied ownership set updated to the current snapshot", () => {
    const fs = fakeFs();
    const state = new Set<string>();

    const result = syncWorkspaceToFileSystem(fs, snapshot([
      { uri: "file:///workspace/a.slang", path: "/workspace/a.slang", source: "a" },
    ]), new Map(), state);

    expect(result).toBe(state);
    expect([...state]).toEqual(["/workspace/a.slang"]);
  });
});
