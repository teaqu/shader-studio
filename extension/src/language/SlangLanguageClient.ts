import { Worker } from "node:worker_threads";

import {
  WorkerClient,
  type SlangWorker,
  type SlangWorkerRequest,
  type SlangWorkerResponse,
} from "@shader-studio/slang-language-service";

export class NodeSlangWorker implements SlangWorker {
  onmessage: ((event: { data: SlangWorkerResponse }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  private readonly worker: Worker;

  constructor(workerScriptPath: string) {
    this.worker = new Worker(workerScriptPath);
    this.worker.on("message", (data: SlangWorkerResponse) => this.onmessage?.({ data }));
    this.worker.on("error", (error) => this.onerror?.({ message: error.message }));
    this.worker.on("exit", (code) => {
      if (code !== 0) {
        this.onerror?.({ message: `Slang language worker exited with code ${code}` });
      }
    });
  }

  postMessage(message: SlangWorkerRequest): void {
    this.worker.postMessage(message);
  }

  terminate(): void {
    void this.worker.terminate();
  }
}

/** Extension-host facade over the shared, replaying Slang RPC client. */
export class SlangLanguageClient extends WorkerClient {
  static forWorkerScript(workerScriptPath: string): SlangLanguageClient {
    return new SlangLanguageClient(() => new NodeSlangWorker(workerScriptPath));
  }
}
