import { describe, expect, it, vi } from "vitest";

import { StaleSlangResultError, WorkerClient } from "../WorkerClient";
import type { SlangWorkerRequest, SlangWorkerResponse } from "../workerProtocol";

class FakeWorker {
  readonly sent: SlangWorkerRequest[] = [];
  onmessage: ((event: { data: SlangWorkerResponse }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminate = vi.fn();

  postMessage(message: SlangWorkerRequest): void {
    this.sent.push(message);
  }

  respond(index: number, result: unknown, documentVersion?: number): void {
    this.onmessage?.({ data: { id: this.sent[index].id, ok: true, result, documentVersion } });
  }

  reject(index: number, error: string): void {
    this.onmessage?.({ data: { id: this.sent[index].id, ok: false, error } });
  }

  crash(message = "worker crashed"): void {
    this.onerror?.({ message });
  }
}

const snapshot = {
  rootUri: "file:///project",
  files: [{ uri: "file:///project/root.slang", path: "root.slang", source: "source" }],
};

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("WorkerClient", () => {
  it("serializes mutations and waits for preceding mutations before queries", async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(() => worker);

    const initialized = client.init(snapshot);
    const opened = client.openDocument({ uri: "file:///project/root.slang", path: "root.slang", source: "one", version: 1 });
    const hovered = client.hover("file:///project/root.slang", { line: 0, character: 0 }, 1);
    await tick();
    expect(worker.sent.map((message) => message.method)).toEqual(["init"]);

    worker.respond(0, undefined);
    await vi.waitFor(() => {
      expect(worker.sent.map((message) => message.method)).toEqual(["init", "openDocument"]);
    });
    worker.respond(1, undefined);
    await vi.waitFor(() => {
      expect(worker.sent.map((message) => message.method)).toEqual(["init", "openDocument", "hover"]);
    });
    worker.respond(2, { contents: { kind: "markdown", value: "x" } }, 1);

    await expect(Promise.all([initialized, opened, hovered])).resolves.toEqual([
      undefined,
      undefined,
      { contents: { kind: "markdown", value: "x" } },
    ]);
  });

  it("drops a query result when the caller's current document version advanced", async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(() => worker);
    const init = client.init(snapshot);
    await tick();
    worker.respond(0, undefined);
    await init;
    const open = client.openDocument({ uri: "file:///project/root.slang", path: "root.slang", source: "one", version: 1 });
    await tick();
    worker.respond(1, undefined);
    await open;

    const hover = client.hover("file:///project/root.slang", { line: 0, character: 0 }, 1);
    await tick();
    void client.changeDocument({ uri: "file:///project/root.slang", path: "root.slang", source: "two", version: 2 });
    worker.respond(2, { value: "old" }, 1);

    await expect(hover).rejects.toBeInstanceOf(StaleSlangResultError);
  });

  it("rejects pending work on crash, recreates the worker, and replays snapshot and open documents", async () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const init = client.init(snapshot);
    await tick();
    workers[0].respond(0, undefined);
    await init;
    const open = client.openDocument({ uri: "file:///project/root.slang", path: "root.slang", source: "unsaved", version: 4 });
    await tick();
    workers[0].respond(1, undefined);
    await open;
    const pending = client.hover("file:///project/root.slang", { line: 0, character: 0 }, 4);
    await tick();

    workers[0].crash("boom");
    await expect(pending).rejects.toThrow("boom");
    expect(workers).toHaveLength(2);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[1].sent[0]).toMatchObject({ method: "init", snapshot });
    workers[1].respond(0, undefined);
    await tick();
    expect(workers[1].sent[1]).toMatchObject({
      method: "openDocument",
      document: expect.objectContaining({ source: "unsaved", version: 4 }),
    });
    workers[1].respond(1, undefined);
    await client.ready();
  });

  it("rejects a response whose reported document version does not match", async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(() => worker);
    const init = client.init(snapshot);
    await tick();
    worker.respond(0, undefined);
    await init;

    const query = client.diagnostics("file:///project/root.slang", 7);
    await tick();
    worker.respond(1, [], 6);
    await expect(query).rejects.toBeInstanceOf(StaleSlangResultError);
  });

  it("accepts a matching caller version for a document not opened through the client", async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(() => worker);
    const init = client.init(snapshot);
    await tick();
    worker.respond(0, undefined);
    await init;

    const query = client.diagnostics("file:///project/root.slang", 7);
    await tick();
    worker.respond(1, [], 7);
    await expect(query).resolves.toEqual([]);
  });

  it("is terminal and idempotent after disposal", async () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const lateWorker = workers[0];
    const lateError = lateWorker.onerror;
    const lateMessage = lateWorker.onmessage;

    client.dispose();
    client.dispose();

    expect(lateWorker.terminate).toHaveBeenCalledOnce();
    expect(lateWorker.onerror).toBeNull();
    expect(lateWorker.onmessage).toBeNull();
    await expect(client.init(snapshot)).rejects.toThrow("disposed");
    await expect(
      client.openDocument({ uri: "file:///project/root.slang", path: "root.slang", source: "one", version: 1 }),
    ).rejects.toThrow("disposed");
    await expect(client.diagnostics("file:///project/root.slang", 1)).rejects.toThrow("disposed");
    lateError?.({ message: "late crash" });
    lateMessage?.({ data: { id: 999, ok: true, result: undefined } });
    expect(workers).toHaveLength(1);
  });

  it("keeps ready pending until recovery swapped by an in-flight mutation crash is stable", async () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const init = client.init(snapshot);
    await tick();
    workers[0].respond(0, undefined);
    await init;
    const open = client.openDocument({
      uri: "file:///project/root.slang",
      path: "root.slang",
      source: "unsaved",
      version: 2,
    });
    await tick();
    workers[0].respond(1, undefined);
    await open;
    const replacement = client.replaceFiles({ ...snapshot, files: [{ ...snapshot.files[0], source: "saved-two" }] });
    await tick();
    const ready = client.ready();
    let readySettled = false;
    void ready.finally(() => {
      readySettled = true;
    });

    workers[0].crash("during mutation");
    await expect(replacement).rejects.toThrow("during mutation");
    await tick();
    expect(readySettled).toBe(false);
    expect(workers[1].sent[0]).toMatchObject({ method: "init" });
    workers[1].respond(0, undefined);
    await vi.waitFor(() => expect(workers[1].sent[1]).toMatchObject({ method: "openDocument" }));
    expect(readySettled).toBe(false);
    workers[1].respond(1, undefined);
    await expect(ready).resolves.toBeUndefined();
  });

  it("follows a replacement recovery when the recovering worker also crashes", async () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const init = client.init(snapshot);
    await tick();
    workers[0].respond(0, undefined);
    await init;
    workers[0].crash("first crash");
    const ready = client.ready();
    workers[1].crash("recovery crash");
    await tick();
    expect(workers).toHaveLength(3);
    workers[2].respond(0, undefined);

    await expect(ready).resolves.toBeUndefined();
  });

  it("rolls back failed open state so the same version can retry and is not replayed", async () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const init = client.init(snapshot);
    await tick();
    workers[0].respond(0, undefined);
    await init;
    const document = { uri: "file:///project/root.slang", path: "root.slang", source: "one", version: 3 };
    const failed = client.openDocument(document);
    await tick();
    workers[0].reject(1, "open rejected");
    await expect(failed).rejects.toThrow("open rejected");

    workers[0].crash();
    expect(workers[1].sent[0]).toMatchObject({ method: "init" });
    workers[1].respond(0, undefined);
    await client.ready();
    expect(workers[1].sent).toHaveLength(1);

    const retry = client.openDocument(document);
    await tick();
    workers[1].respond(1, undefined);
    await retry;
  });

  it("rolls back failed change and close state so their versions can retry", async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(() => worker);
    const init = client.init(snapshot);
    await tick();
    worker.respond(0, undefined);
    await init;
    const first = { uri: "file:///project/root.slang", path: "root.slang", source: "one", version: 1 };
    const open = client.openDocument(first);
    await tick();
    worker.respond(1, undefined);
    await open;

    const second = { ...first, source: "two", version: 2 };
    const failedChange = client.changeDocument(second);
    await tick();
    worker.reject(2, "change rejected");
    await expect(failedChange).rejects.toThrow("change rejected");
    const retryChange = client.changeDocument(second);
    await tick();
    worker.respond(3, undefined);
    await retryChange;

    const failedClose = client.closeDocument(second.uri, second.version);
    await tick();
    worker.reject(4, "close rejected");
    await expect(failedClose).rejects.toThrow("close rejected");
    const retryClose = client.closeDocument(second.uri, second.version);
    await tick();
    worker.respond(5, undefined);
    await retryClose;
  });

  it("does not let an older failed mutation roll back newer queued desired state", async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(() => worker);
    const init = client.init(snapshot);
    await tick();
    worker.respond(0, undefined);
    await init;
    const first = { uri: "file:///project/root.slang", path: "root.slang", source: "one", version: 1 };
    const failedOpen = client.openDocument(first);
    const newerChange = client.changeDocument({ ...first, source: "two", version: 2 });
    await tick();
    worker.reject(1, "open rejected");
    await expect(failedOpen).rejects.toThrow("open rejected");
    await vi.waitFor(() => expect(worker.sent[2]).toMatchObject({ method: "changeDocument" }));
    worker.respond(2, undefined);
    await newerChange;

    const close = client.closeDocument(first.uri, 2);
    await tick();
    worker.respond(3, undefined);
    await expect(close).resolves.toBeUndefined();
  });
});
