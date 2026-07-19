import { describe, expect, it, vi } from "vitest";

import { StaleSlangResultError, SupersededSlangMutationError, WorkerClient } from "../WorkerClient";
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
  it("does not reset the recovery budget when crashing repeatedly before init", async () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }, { maxConsecutiveRestarts: 1 });

    workers[0].crash("pre-init crash");
    await tick();
    expect(workers).toHaveLength(2);
    expect(workers[1].sent).toHaveLength(0);
    workers[1].crash("pre-init recovery crash");
    await tick();

    expect(workers).toHaveLength(2);
    await expect(client.ready()).rejects.toThrow("pre-init recovery crash");
  });

  it("stops after one consecutive recovery attempt and rejects terminal work", async () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }, { maxConsecutiveRestarts: 1 });
    const init = client.init(snapshot);
    await tick();

    workers[0].crash("initial worker failed");
    await expect(init).rejects.toThrow("initial worker failed");
    expect(workers).toHaveLength(2);
    workers[1].crash("recovery worker failed");
    await tick();

    expect(workers).toHaveLength(2);
    await expect(client.ready()).rejects.toThrow("recovery worker failed");
    await expect(client.diagnostics("file:///project/root.slang", 1)).rejects.toThrow("recovery worker failed");
  });

  it("resets the recovery budget after a successful replay", async () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }, { maxConsecutiveRestarts: 1 });
    const init = client.init(snapshot);
    await tick();
    workers[0].respond(0, true);
    await init;

    workers[0].crash("first independent crash");
    workers[1].respond(0, true);
    await client.ready();
    workers[1].crash("second independent crash");

    expect(workers).toHaveLength(3);
    workers[2].respond(0, true);
    await expect(client.ready()).resolves.toBeUndefined();
  });

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

  it("re-opens the latest desired document when an in-flight open fails before a queued change", async () => {
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
    const first = { uri: "file:///project/root.slang", path: "root.slang", source: "one", version: 1 };
    const failedOpen = client.openDocument(first);
    await tick();
    expect(workers[0].sent[1]).toMatchObject({ method: "openDocument", document: first });
    const newerChange = client.changeDocument({ ...first, source: "two", version: 2 });
    workers[0].reject(1, "open rejected");
    await expect(failedOpen).rejects.toThrow("open rejected");
    await vi.waitFor(() =>
      expect(workers[0].sent[2]).toMatchObject({
        method: "openDocument",
        document: expect.objectContaining({ source: "two", version: 2 }),
      }),
    );
    workers[0].respond(2, undefined);
    await newerChange;

    workers[0].crash();
    workers[1].respond(0, undefined);
    await vi.waitFor(() =>
      expect(workers[1].sent[1]).toMatchObject({
        method: "openDocument",
        document: expect.objectContaining({ source: "two", version: 2 }),
      }),
    );
    workers[1].respond(1, undefined);
    await client.ready();
  });

  it("does not replay an unacknowledged predecessor when both chained opens fail", async () => {
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
    const first = { uri: "file:///project/root.slang", path: "root.slang", source: "one", version: 1 };
    const failedFirst = client.openDocument(first);
    await tick();
    const second = { ...first, source: "two", version: 2 };
    const failedSecond = client.changeDocument(second);
    workers[0].respond(1, false);
    await expect(failedFirst).rejects.toThrow("returned false");
    await vi.waitFor(() => expect(workers[0].sent[2]).toMatchObject({ method: "openDocument", document: second }));
    workers[0].respond(2, false);
    await expect(failedSecond).rejects.toThrow("returned false");

    workers[0].crash();
    workers[1].respond(0, undefined);
    await tick();
    const replayedDocument = workers[1].sent[1];
    if (replayedDocument) {
      workers[1].respond(1, undefined);
    }
    await client.ready();
    expect(replayedDocument).toBeUndefined();
    const retry = client.openDocument(second);
    await tick();
    expect(workers[1].sent[1]).toMatchObject({ method: "openDocument", document: second });
    workers[1].respond(1, undefined);
    await expect(retry).resolves.toBeUndefined();
  });

  it("treats boolean false as a failed mutation and permits the same version to retry", async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(() => worker);
    const init = client.init(snapshot);
    await tick();
    worker.respond(0, undefined);
    await init;
    const document = { uri: "file:///project/root.slang", path: "root.slang", source: "one", version: 1 };
    const failed = client.openDocument(document);
    await tick();
    worker.respond(1, false);
    await expect(failed).rejects.toThrow("returned false");

    const retry = client.openDocument(document);
    await tick();
    expect(worker.sent[2]).toMatchObject({ method: "openDocument", document });
    worker.respond(2, true);
    await expect(retry).resolves.toBeUndefined();
  });

  it("rebases a queued newer change on acknowledged state after an earlier change returns false", async () => {
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
    const third = { ...first, source: "three", version: 3 };
    const failedChange = client.changeDocument(second);
    await tick();
    const latestChange = client.changeDocument(third);
    worker.respond(2, false);
    await expect(failedChange).rejects.toThrow("returned false");
    await vi.waitFor(() => expect(worker.sent[3]).toMatchObject({ method: "changeDocument", document: third }));
    worker.respond(3, undefined);
    await expect(latestChange).resolves.toBeUndefined();
  });

  it("replays the last acknowledged document when an in-flight change crashes", async () => {
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
    const first = { uri: "file:///project/root.slang", path: "root.slang", source: "one", version: 1 };
    const open = client.openDocument(first);
    await tick();
    workers[0].respond(1, undefined);
    await open;
    const change = client.changeDocument({ ...first, source: "two", version: 2 });
    await tick();

    workers[0].crash("change crashed");
    await expect(change).rejects.toThrow("change crashed");
    workers[1].respond(0, undefined);
    await vi.waitFor(() => expect(workers[1].sent[1]).toMatchObject({ method: "openDocument", document: first }));
    workers[1].respond(1, undefined);
    await client.ready();
  });

  it("rebases a queued reopen to change when an earlier close returns false", async () => {
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
    const close = client.closeDocument(first.uri, 1);
    await tick();
    const reopened = { ...first, source: "two", version: 2 };
    const reopen = client.openDocument(reopened);
    worker.respond(2, false);
    await expect(close).rejects.toThrow("returned false");
    await vi.waitFor(() => expect(worker.sent[3]).toMatchObject({ method: "changeDocument", document: reopened }));
    worker.respond(3, undefined);
    await expect(reopen).resolves.toBeUndefined();
  });

  it("rejects a mutation superseded before execution while the latest request reconciles", async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(() => worker);
    const init = client.init(snapshot);
    await tick();
    worker.respond(0, undefined);
    await init;
    const first = { uri: "file:///project/root.slang", path: "root.slang", source: "one", version: 1 };
    const superseded = client.openDocument(first);
    const latest = client.changeDocument({ ...first, source: "two", version: 2 });

    await expect(superseded).rejects.toBeInstanceOf(SupersededSlangMutationError);
    await vi.waitFor(() =>
      expect(worker.sent[1]).toMatchObject({
        method: "openDocument",
        document: expect.objectContaining({ source: "two", version: 2 }),
      }),
    );
    worker.respond(1, undefined);
    await expect(latest).resolves.toBeUndefined();
  });
});
