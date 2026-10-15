import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

const TOKEN_SECRET_KEY = 'shader-studio.mcpToken';

export interface McpConnectionStatus {
  enabled: boolean;
  trusted: boolean;
  ready: boolean;
  url?: string;
  message?: string;
}

/** Keeps the MCP credential out of settings and presents copyable client setup. */
export class McpConnection implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[];
  private tokenLoad?: Promise<string>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly reconfigure: () => void,
    private readonly getStatus: () => McpConnectionStatus,
  ) {
    this.disposables = [
      vscode.commands.registerCommand('shader-studio.connectAiAssistant', () => this.showSetup()),
      vscode.commands.registerCommand('shader-studio.copyCodexMcpConfig', () => this.copyCodexConfiguration()),
      vscode.commands.registerCommand('shader-studio.copyClaudeCodeMcpConfig', () => this.copyClaudeCodeConfiguration()),
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
    vscode.window.showInformationMessage('MCP token regenerated. Copy the updated client configuration before reconnecting your assistant.');
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async showSetup(): Promise<void> {
    const status = this.getStatus();
    if (!status.enabled) {
      const choice = await vscode.window.showInformationMessage('MCP is disabled. Enable Shader Studio MCP to connect an AI assistant.', 'Open Settings');
      if (choice === 'Open Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'shader-studio.mcpEnabled');
      }
      return;
    }
    if (!status.trusted) {
      vscode.window.showWarningMessage('Trust this workspace before connecting an AI assistant to Shader Studio MCP.');
      return;
    }
    if (!status.ready || !status.url) {
      vscode.window.showWarningMessage(status.message ?? 'Shader Studio MCP is starting. Try again when it is ready.');
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      `Shader Studio MCP is ready at ${status.url}.`,
      'Copy Codex TOML',
      'Copy Claude Code JSON',
      'Verify Connection',
      'Regenerate Token',
    );
    if (choice === 'Copy Codex TOML') {
      await this.copyCodexConfiguration();
    } else if (choice === 'Copy Claude Code JSON') {
      await this.copyClaudeCodeConfiguration();
    } else if (choice === 'Verify Connection') {
      await this.verifyConnection();
    } else if (choice === 'Regenerate Token') {
      await this.regenerateToken();
    }
  }

  private async copyCodexConfiguration(): Promise<void> {
    const configuration = await this.clientConfiguration((url, token) => [
      '[mcp_servers.shader-studio]',
      `url = "${url}"`,
      `http_headers = { Authorization = ${tomlString(`Bearer ${token}`)} }`,
    ].join('\n'));
    if (configuration) {
      await vscode.env.clipboard.writeText(configuration);
      vscode.window.showInformationMessage('Codex MCP configuration copied. Merge it into private ~/.codex/config.toml, then restart MCP.');
    }
  }

  private async copyClaudeCodeConfiguration(): Promise<void> {
    const configuration = await this.clientConfiguration((url, token) => JSON.stringify({
      mcpServers: { 'shader-studio': { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } },
    }, null, 2));
    if (configuration) {
      await vscode.env.clipboard.writeText(configuration);
      vscode.window.showInformationMessage('Claude Code MCP configuration copied. Merge it into private ~/.claude.json, then restart Claude Code.');
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
    return format(url, await this.getToken());
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
    try {
      const transport = new StreamableHTTPClientTransport(new URL(url), {
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
      await client.close().catch(() => undefined);
    }
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function previewCount(value: unknown): number | undefined {
  if (value && typeof value === 'object' && 'previews' in value && Array.isArray(value.previews)) {
    return value.previews.length;
  }
  return undefined;
}
