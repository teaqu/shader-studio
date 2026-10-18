import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { mcpConnectionHtml } from './McpConnectionView';

const TOKEN_SECRET_KEY = 'shader-studio.mcpToken';

export interface McpConnectionStatus {
  enabled: boolean;
  trusted: boolean;
  ready: boolean;
  url?: string;
  message?: string;
  connectedAssistants?: number;
}

/** Keeps the MCP credential out of settings and presents copyable client setup. */
export class McpConnection implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[];
  private tokenLoad?: Promise<string>;
  private panel?: vscode.WebviewPanel;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshVersion = 0;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly reconfigure: () => void,
    private readonly getStatus: () => McpConnectionStatus,
  ) {
    this.disposables = [
      vscode.commands.registerCommand('shader-studio.connectAiAssistant', () => this.showSetup()),
      vscode.commands.registerCommand('shader-studio.regenerateMcpToken', () => this.regenerateToken()),
      vscode.commands.registerCommand('shader-studio.verifyMcpConnection', () => this.verifyConnection()),
      context.secrets.onDidChange(event => {
        if (event.key === TOKEN_SECRET_KEY) {
          this.reconfigure();
        }
      }),
    ];
  }

  async getToken(): Promise<string> {
    this.tokenLoad ??= this.loadToken().finally(() => {
      this.tokenLoad = undefined;
    });
    return this.tokenLoad;
  }

  private async loadToken(): Promise<string> {
    const existing = await this.context.secrets.get(TOKEN_SECRET_KEY);
    if (existing) {
      return existing;
    }
    const token = randomBytes(32).toString('hex');
    await this.context.secrets.store(TOKEN_SECRET_KEY, token);
    return token;
  }

  async regenerateToken(): Promise<void> {
    if (!this.requireEnabled()) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      'Regenerate the MCP token? Connected assistants will need the new token.',
      { modal: true },
      'Regenerate',
    );
    if (choice !== 'Regenerate') {
      return;
    }
    await this.context.secrets.store(TOKEN_SECRET_KEY, randomBytes(32).toString('hex'));
    vscode.window.showInformationMessage('Token regenerated. Copy the new token before reconnecting your assistant.');
  }

  dispose(): void {
    this.panel?.dispose();
    this.clearPanel();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private showSetup(): void {
    if (this.panel) {
      this.panel.reveal();
      void this.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel('shader-studio.aiConnection', 'AI connection', vscode.ViewColumn.Active, {
      enableScripts: true, localResourceRoots: [],
    });
    this.panel = panel;
    panel.webview.html = mcpConnectionHtml(randomBytes(16).toString('hex'));
    const messages = panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message).catch(() => this.notice('Could not complete that action. Try again.'));
    });
    panel.onDidDispose(() => {
      messages.dispose();
      this.clearPanel();
    });
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch(() => this.notice('Could not refresh the connection.'));
    }, 1000);
  }

  private clearPanel(): void {
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    this.panel = undefined;
    this.refreshVersion++;
  }

  private async refresh(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const version = ++this.refreshVersion;
    const status = { ...this.getStatus() };
    const ready = status.enabled && status.trusted && status.ready && Boolean(status.url);
    const token = ready ? await this.getToken() : '';
    if (version !== this.refreshVersion || panel !== this.panel) {
      return;
    }
    const latest = this.getStatus();
    if (latest.enabled !== status.enabled || latest.trusted !== status.trusted || latest.ready !== status.ready || latest.url !== status.url) {
      await this.refresh();
      return;
    }
    await panel.webview.postMessage({ type: 'state', enabled: status.enabled, trusted: status.trusted, ready, ...connectionPresentation(status, ready), url: ready ? status.url : '', token });
  }

  private notice(text: string): void {
    void this.panel?.webview.postMessage({ type: 'notice', text });
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object' || !('action' in message)) {
      return;
    }
    const action = message.action;
    if (action === 'ready') {
      await this.refresh();
    } else if (action === 'setEnabled' && 'enabled' in message && typeof message.enabled === 'boolean') {
      if (message.enabled && !this.getStatus().trusted) {
        this.notice('Trust this workspace before enabling the AI connection.');
      } else {
        await vscode.workspace.getConfiguration('shader-studio').update('mcpEnabled', message.enabled, vscode.ConfigurationTarget.Global);
      }
      await this.refresh();
    } else if (action === 'port') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'shader-studio.mcpPort');
    } else if (action === 'verify') {
      await this.verifyConnection();
    } else if (action === 'regenerate') {
      await this.regenerateToken();
      await this.refresh();
    } else if (action === 'copyUrl' || action === 'copyToken' || action === 'copyPrompt') {
      const value = await this.clientConfiguration((url, token) => action === 'copyUrl' ? url : action === 'copyToken' ? token : setupPrompt(url, token));
      if (value) {
        await vscode.env.clipboard.writeText(value);
        this.notice(action === 'copyUrl' ? 'Server URL copied.' : action === 'copyToken' ? 'Token copied.' : 'Setup prompt copied. It includes your private token.');
      }
    }
  }

  private async clientConfiguration(format: (url: string, token: string) => string): Promise<string | undefined> {
    const status = this.getStatus();
    const url = status.url;
    if (!this.requireReady(status) || !url) {
      if (status.enabled && status.trusted) {
        vscode.window.showWarningMessage(status.message ?? 'Shader Studio MCP is not ready yet.');
      }
      return undefined;
    }
    const token = await this.getToken();
    const latest = this.getStatus();
    return latest.enabled && latest.trusted && latest.ready && latest.url === url ? format(url, token) : undefined;
  }

  private requireEnabled(): boolean {
    const status = this.getStatus();
    if (status.enabled && status.trusted) {
      return true;
    }
    vscode.window.showWarningMessage(status.enabled
      ? 'Trust this workspace before copying or regenerating the MCP token.'
      : 'Enable Shader Studio MCP before copying or regenerating its token.');
    return false;
  }

  private requireReady(status: McpConnectionStatus): boolean {
    return this.requireEnabled() && status.ready && Boolean(status.url);
  }

  private async verifyConnection(): Promise<void> {
    const status = this.getStatus();
    const url = status.url;
    if (!this.requireReady(status) || !url) {
      if (status.enabled && status.trusted) {
        vscode.window.showWarningMessage(status.message ?? 'Shader Studio MCP is not ready yet.');
      }
      return;
    }
    const token = await this.getToken();
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'shader-studio-connection-check', version: '1' });
    let transport: InstanceType<typeof StreamableHTTPClientTransport> | undefined;
    try {
      transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      await client.connect(transport);
      const tools = await client.listTools();
      const previews = await client.callTool({ name: 'list_previews', arguments: {} });
      if (previews.isError) {
        throw new Error('list_previews failed');
      }
      const count = previewCount(previews.structuredContent);
      vscode.window.showInformationMessage(`MCP connection verified: ${tools.tools.length} tools available; ${count === undefined ? 'preview status available' : `${count} previews open`}.`);
    } catch {
      vscode.window.showErrorMessage('Could not verify the MCP connection. Check that Shader Studio MCP is running, then try again.');
    } finally {
      await transport?.terminateSession().catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  }
}

function connectionPresentation(status: McpConnectionStatus, ready: boolean): { status: string; detail: string } {
  if (!status.enabled) {
    return { status: 'AI connection disabled', detail: 'Enable the connection to see your server URL and token.' };
  }
  if (!status.trusted) {
    return { status: 'Workspace trust required', detail: 'Trust this workspace to allow an assistant to access it.' };
  }
  if (status.message) {
    return { status: 'Connection unavailable', detail: status.message };
  }
  if (!ready) {
    return { status: 'Starting connection…', detail: 'The local server is starting.' };
  }
  const count = status.connectedAssistants ?? 0;
  return count > 0
    ? { status: 'Assistant connected', detail: `${count} active assistant session${count === 1 ? '' : 's'}.` }
    : { status: 'Waiting for an assistant', detail: 'Server ready. Add these details to your assistant’s MCP settings, or copy the setup prompt.' };
}

function setupPrompt(url: string, token: string): string {
  return [
    'Connect this local AI assistant to Shader Studio using your supported MCP configuration method.',
    'Server name: shader-studio',
    'Transport: Streamable HTTP (the VS Code extension already runs the server; no launch command is needed).',
    `Server URL: ${url}`,
    `Authorization header: Bearer ${token}`,
    'Keep the token in private local configuration. Preserve unrelated settings and do not commit or repeat the token in your response.',
    'If MCP configuration cannot be added or reloaded from this chat, explain the exact remaining setup or restart step for this client. Do not claim the connection succeeded until an MCP tool call succeeds.',
    'Once connected, call list_previews and read_documentation (omit topic for the index). Select the preview I mean, then inspect get_shader, get_settings and get_resources before editing.',
    'Read files before update_file and pass the returned revision. After edits, inspect get_diagnostics and capture_output. Ask what I want to change before making shader edits.',
  ].join('\n');
}

function previewCount(value: unknown): number | undefined {
  if (value && typeof value === 'object' && 'previews' in value && Array.isArray(value.previews)) {
    return value.previews.length;
  }
  return undefined;
}
