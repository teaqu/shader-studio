import {
  WorkerClient,
  type SlangWorker,
  type SlangWorkerRequest,
  type SlangWorkerResponse,
} from '@shader-studio/slang-language-service';
import workerUrl from './slangLanguageWorker.ts?worker&url';

class BrowserSlangWorker implements SlangWorker {
  onmessage: ((event: { data: SlangWorkerResponse }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  private readonly worker = new Worker(workerUrl, { type: 'module', name: 'shader-studio-slang-language' });

  constructor() {
    this.worker.onmessage = (event: MessageEvent<SlangWorkerResponse>) => this.onmessage?.({ data: event.data });
    this.worker.onerror = (event: ErrorEvent) => this.onerror?.({ message: event.message });
  }

  postMessage(message: SlangWorkerRequest): void {
    this.worker.postMessage(message);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

let client: WorkerClient | undefined;

export function getBrowserSlangLanguageClient(): WorkerClient {
  client ??= new WorkerClient(() => new BrowserSlangWorker(), { maxConsecutiveRestarts: 1 });
  return client;
}
