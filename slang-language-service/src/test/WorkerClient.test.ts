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
});
