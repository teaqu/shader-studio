import type { WorkerPort } from "@shader-studio/language-server-core";

export interface WorkerAsset {
  url: string;
  mimeType: string;
  mode: "text" | "binary";
}

interface WorkerRuntime {
  fetch(url: string): Promise<Pick<Response, "ok" | "status" | "text" | "arrayBuffer">>;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createWorker(url: string): Worker;
}

const browserRuntime: WorkerRuntime = {
  fetch: url => fetch(url),
  createObjectURL: blob => URL.createObjectURL(blob),
  revokeObjectURL: url => URL.revokeObjectURL(url),
  createWorker: url => new Worker(url, { type: "module" }),
};

export interface WebviewWorkerBundle {
  port: WorkerPort;
  assetUrls: readonly string[];
}

/**
 * Converts extension-resource URLs to same-origin blob URLs before creating a
 * worker. VS Code webviews cannot construct a worker directly from their
 * `https://file+.vscode-resource…` asset URL.
 */
export async function createWebviewWorker(
  workerAsset: WorkerAsset,
  supportingAssets: readonly WorkerAsset[] = [],
  runtime: WorkerRuntime = browserRuntime,
): Promise<WebviewWorkerBundle> {
  const objectUrls: string[] = [];
  try {
    for (const asset of [workerAsset, ...supportingAssets]) {
      const response = await runtime.fetch(asset.url);
      if (!response.ok) {
        throw new Error(`Failed to load language-service worker asset (${response.status}): ${asset.url}`);
      }
      const source = asset.mode === "text" ? await response.text() : await response.arrayBuffer();
      objectUrls.push(runtime.createObjectURL(new Blob([source], { type: asset.mimeType })));
    }
    const workerUrl = objectUrls[0];
    if (!workerUrl) {
      throw new Error("Language-service worker asset did not produce an object URL");
    }
    const worker = runtime.createWorker(workerUrl);
    return {
      port: revokingPort(worker, objectUrls, runtime.revokeObjectURL),
      assetUrls: objectUrls.slice(1),
    };
  } catch (error) {
    for (const url of objectUrls) {
      runtime.revokeObjectURL(url);
    }
    throw error;
  }
}

function revokingPort(
  worker: Worker,
  objectUrls: readonly string[],
  revokeObjectURL: (url: string) => void,
): WorkerPort {
  let terminated = false;
  return {
    postMessage: message => worker.postMessage(message),
    addEventListener: (_type, listener) => worker.addEventListener("message", listener),
    removeEventListener: (_type, listener) => worker.removeEventListener("message", listener),
    terminate() {
      if (terminated) {
        return;
      }
      terminated = true;
      worker.terminate();
      for (const url of objectUrls) {
        revokeObjectURL(url);
      }
    },
  };
}
