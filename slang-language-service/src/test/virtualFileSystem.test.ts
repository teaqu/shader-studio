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

  it("preserves literal percent escapes in canonical workspace paths", () => {
    const fs = fakeFs();

    syncWorkspaceToFileSystem(fs, snapshot([
      {
        uri: "file:///workspace/a%252Fb.slang",
        path: "/workspace/a%2Fb.slang",
        source: "literal percent",
      },
    ]));

    expect(fs.writeFile).toHaveBeenCalledWith("/workspace/a%2Fb.slang", "literal percent");
    expect(fs.writeFile).not.toHaveBeenCalledWith("/workspace/a/b.slang", expect.anything());
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

  it("retains retryable ownership when creating a directory fails", () => {
    const fs = fakeFs(["/workspace/old.slang"]);
    fs.mkdirTree.mockImplementationOnce(() => {
      throw new Error("mkdir failed");
    });
    const state = new Set(["/workspace/old.slang"]);

    expect(() => syncWorkspaceToFileSystem(fs, snapshot([
      { uri: "file:///workspace/new.slang", path: "/workspace/new.slang", source: "new" },
    ]), new Map(), state)).toThrow("mkdir failed");

    expect(state).toEqual(new Set(["/workspace/old.slang", "/workspace/new.slang"]));
    expect(fs.unlink).not.toHaveBeenCalled();

    syncWorkspaceToFileSystem(fs, snapshot([
      { uri: "file:///workspace/new.slang", path: "/workspace/new.slang", source: "new" },
    ]), new Map(), state);
    expect(state).toEqual(new Set(["/workspace/new.slang"]));
  });

  it("retains retryable ownership when writing a file fails", () => {
    const fs = fakeFs(["/workspace/old.slang"]);
    fs.writeFile.mockImplementationOnce(() => {
      throw new Error("write failed");
    });
    const state = new Set(["/workspace/old.slang"]);

    expect(() => syncWorkspaceToFileSystem(fs, snapshot([
      { uri: "file:///workspace/new.slang", path: "/workspace/new.slang", source: "new" },
    ]), new Map(), state)).toThrow("write failed");

    expect(state).toEqual(new Set(["/workspace/old.slang", "/workspace/new.slang"]));
    expect(fs.unlink).not.toHaveBeenCalled();

    syncWorkspaceToFileSystem(fs, snapshot([
      { uri: "file:///workspace/new.slang", path: "/workspace/new.slang", source: "new" },
    ]), new Map(), state);
    expect(state).toEqual(new Set(["/workspace/new.slang"]));
  });

  it("retains old and current ownership when deleting a stale file fails", () => {
    const fs = fakeFs(["/workspace/old.slang"]);
    fs.unlink.mockImplementationOnce(() => {
      throw new Error("unlink failed");
    });
    const state = new Set(["/workspace/old.slang"]);

    expect(() => syncWorkspaceToFileSystem(fs, snapshot([
      { uri: "file:///workspace/new.slang", path: "/workspace/new.slang", source: "new" },
    ]), new Map(), state)).toThrow("unlink failed");

    expect(fs.writeFile).toHaveBeenCalledWith("/workspace/new.slang", "new");
    expect(state).toEqual(new Set(["/workspace/old.slang", "/workspace/new.slang"]));

    syncWorkspaceToFileSystem(fs, snapshot([
      { uri: "file:///workspace/new.slang", path: "/workspace/new.slang", source: "new" },
    ]), new Map(), state);
    expect(state).toEqual(new Set(["/workspace/new.slang"]));
  });
});
