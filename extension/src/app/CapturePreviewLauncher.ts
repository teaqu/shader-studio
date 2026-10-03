export const INTEGRATED_BROWSER_COMMAND = 'workbench.action.browser.open';

export interface CapturePreviewHost {
  getCommands(): PromiseLike<string[]>;
  startServer(): void;
  isServerRunning(): boolean;
  getServerUrl(): string;
  openIntegratedBrowser(url: string): PromiseLike<unknown>;
  openExternalBrowser(url: string): PromiseLike<unknown>;
}

/** Opens the synced viewer in a capture-capable host, without changing webview permissions. */
export async function openCapturePreview(host: CapturePreviewHost): Promise<void> {
  const commands = await host.getCommands();
  if (!host.isServerRunning()) {
    host.startServer();
  }
  if (!host.isServerRunning()) {
    throw new Error('The Shader Studio web server could not start.');
  }
  const url = host.getServerUrl();
  if (commands.includes(INTEGRATED_BROWSER_COMMAND)) {
    await host.openIntegratedBrowser(url);
  } else {
    await host.openExternalBrowser(url);
  }
}
