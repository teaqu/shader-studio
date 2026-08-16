import { describe, expect, it, vi } from "vitest";
import type { LanguageService } from "../protocol";
import { runLanguageServiceWorker, WorkerLanguageServiceClient, type WorkerPort } from "../workerTransport";

function linkedPorts(): [WorkerPort, WorkerPort] {
  const listeners = [new Set<(event: { data: unknown }) => void>(), new Set<(event: { data: unknown }) => void>()];
  return [0, 1].map((side) => ({
    postMessage(message: unknown) {
      queueMicrotask(() => listeners[1 - side]?.forEach((listener) => listener({ data: message })));
    },
    addEventListener(_type: "message", listener: (event: { data: unknown }) => void) {
      listeners[side]?.add(listener);
    },
    removeEventListener(_type: "message", listener: (event: { data: unknown }) => void) {
      listeners[side]?.delete(listener);
    },
  })) as [WorkerPort, WorkerPort];
}

describe("worker transport", () => {
  it("correlates lifecycle requests and responses", async () => {
    const [clientPort, serverPort] = linkedPorts();
    const capabilities = {
      completion: true,
      hover: true,
      definition: true,
      signatureHelp: true,
      documentSymbols: true,
      diagnostics: true,
      documentColors: true,
    };
    const service = { initialize: vi.fn().mockResolvedValue(capabilities) } as unknown as LanguageService;
    const stop = runLanguageServiceWorker(serverPort, service);
    const client = new WorkerLanguageServiceClient(clientPort);

    await expect(client.request("initialize", undefined)).resolves.toEqual(capabilities);

    client.dispose();
    stop();
  }, 1_000);

  it("correlates requests and echoes analysis revisions", async () => {
    const [clientPort, serverPort] = linkedPorts();
    const service = { completion: vi.fn().mockResolvedValue([{ label: "mix" }]) } as unknown as LanguageService;
    const stop = runLanguageServiceWorker(serverPort, service);
    const client = new WorkerLanguageServiceClient(clientPort);
    const params = { document: { uri: "file:///a.glsl", languageId: "glsl" as const, version: 2, environmentGeneration: 3 }, position: { line: 0, character: 1 } };
    await expect(client.request("completion", params)).resolves.toEqual([{ label: "mix" }]);
    expect(service.completion).toHaveBeenCalledWith(params);
    client.dispose();
    stop();
  });

  it("rejects pending work when disposed", async () => {
    const [clientPort] = linkedPorts();
    const client = new WorkerLanguageServiceClient(clientPort);
    const pending = client.request("initialize", undefined);
    client.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
  });
});
