import * as assert from "assert";
import type {
  SlangWorker,
  SlangWorkerRequest,
  SlangWorkerResponse,
  SlangWorkspaceSnapshot,
} from "@shader-studio/slang-language-service";
import { SlangLanguageClient } from "../../language/SlangLanguageClient";

class TestWorker implements SlangWorker {
  onmessage: ((event: { data: SlangWorkerResponse }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  readonly messages: SlangWorkerRequest[] = [];
  terminated = false;

  postMessage(message: SlangWorkerRequest): void {
    this.messages.push(message);
  }

  respond(result: unknown = true, documentVersion?: number): void {
    const request = this.messages.at(-1);
    if (!request) {
      throw new Error("No request");
    }
    this.onmessage?.({ data: { id: request.id, ok: true, result, documentVersion } });
  }

  terminate(): void {
    this.terminated = true;
  }
}

async function waitForMessage(worker: TestWorker, count: number): Promise<void> {
  while (worker.messages.length < count) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

suite("SlangLanguageClient", () => {
  const snapshot: SlangWorkspaceSnapshot = {
    rootUri: "file:///workspace",
    files: [{ uri: "file:///workspace/main.slang", path: "main.slang", source: "", version: 1 }],
  };

  test("delegates document lifecycle and drops stale query results", async () => {
    const worker = new TestWorker();
    const client = new SlangLanguageClient(() => worker);
    const init = client.init(snapshot);
    await waitForMessage(worker, 1);
    worker.respond();
    await init;
    const open = client.openDocument(snapshot.files[0] as Required<(typeof snapshot.files)[number]>);
    await waitForMessage(worker, 2);
    worker.respond();
    await open;

    const hover = client.hover("file:///workspace/main.slang", { line: 0, character: 2 }, 1);
    await waitForMessage(worker, 3);
    worker.respond(undefined, 0);
    await assert.rejects(hover, /Dropped stale Slang result/);

    client.dispose();
    assert.strictEqual(worker.terminated, true);
  });

  test("restarts after a crash and replays workspace and open documents", async () => {
    const workers: TestWorker[] = [];
    const client = new SlangLanguageClient(() => {
      const worker = new TestWorker();
      workers.push(worker);
      return worker;
    });
    const init = client.init(snapshot);
    await waitForMessage(workers[0], 1);
    workers[0].respond();
    await init;
    const open = client.openDocument(snapshot.files[0] as Required<(typeof snapshot.files)[number]>);
    await waitForMessage(workers[0], 2);
    workers[0].respond();
    await open;

    workers[0].onerror?.({ message: "boom" });
    await waitForMessage(workers[1], 1);
    assert.strictEqual(workers.length, 2);
    assert.strictEqual(workers[1].messages[0]?.method, "init");
    workers[1].respond();
    await waitForMessage(workers[1], 2);
    assert.strictEqual(workers[1].messages[1]?.method, "openDocument");
    workers[1].respond();
    await client.ready();
  });
});
