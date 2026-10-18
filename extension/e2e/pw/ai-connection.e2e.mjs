import { test, expect } from './fixtures.mjs';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test.use({ vscodeKey: 'ai-connection' });

async function findConnectionScreen(vscode) {
  let screen;
  await expect.poll(async () => {
    for (const frame of vscode.window.frames()) {
      try {
        if (await frame.getByRole('heading', { name: 'AI connection', exact: true }).isVisible()) {
          screen = frame;
          return true;
        }
      } catch (error) {
        // Closing a panel detaches its frame while VS Code is replacing it.
        if (!frame.isDetached()) {
          throw error;
        }
      }
    }
    return false;
  }).toBe(true);
  return screen;
}

test('enables AI access, copies generic setup, tracks a real assistant and disables access', async ({ vscode }, testInfo) => {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  await vscode.evaluateInHost(async (vscode, port) => {
    const config = vscode.workspace.getConfiguration('shader-studio');
    await config.update('mcpEnabled', false, vscode.ConfigurationTarget.Global);
    await config.update('mcpPort', port, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('shader-studio.connectAiAssistant');
  }, port);
  const screen = await findConnectionScreen(vscode);
  await expect(screen.locator('#status')).toHaveText('AI connection disabled');
  await expect(screen.getByRole('button', { name: 'Copy token', exact: true })).toBeDisabled();
  await expect(screen.locator('details')).not.toHaveAttribute('open', '');
  await screen.getByLabel('Enable AI connection', { exact: true }).check();
  await expect(screen.locator('#status')).toHaveText('Waiting for an assistant');
  const url = await screen.getByLabel('Server URL', { exact: true }).inputValue();
  const token = await screen.getByLabel('Token', { exact: true }).inputValue();
  expect(url).toBe(`http://127.0.0.1:${port}/mcp`);
  await expect(screen.getByLabel('Token', { exact: true })).toHaveAttribute('type', 'password');
  await screen.getByRole('button', { name: 'Show token', exact: true }).click();
  await expect(screen.getByLabel('Token', { exact: true })).toHaveAttribute('type', 'text');
  await screen.getByRole('button', { name: 'Hide token', exact: true }).click();
  for (const [name, expected] of [['Copy URL', url], ['Copy token', token]]) {
    await screen.getByRole('button', { name, exact: true }).click();
    await expect.poll(() => vscode.evaluateInHost(async (vscode, expected) => (await vscode.env.clipboard.readText()) === expected, expected)).toBe(true);
  }
  await screen.getByRole('button', { name: 'Copy setup prompt', exact: true }).click();
  await expect.poll(() => vscode.evaluateInHost(async (vscode) => {
    const prompt = await vscode.env.clipboard.readText();
    return ['Streamable HTTP', 'Authorization header: Bearer ', 'list_previews', 'read_documentation', 'restart'].every(text => prompt.includes(text));
  })).toBe(true);
  await screen.locator('body').screenshot({ path: testInfo.outputPath('ai-connection.png') });
  const client = new Client({ name: 'ai-connection-e2e', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  try {
    await client.connect(transport);
    await client.listTools();
    await expect(screen.locator('#status')).toHaveText('Assistant connected');
    await transport.terminateSession();
    await expect(screen.locator('#status')).toHaveText('Waiting for an assistant');
    await screen.locator('summary').click();
    await screen.getByRole('button', { name: 'Check server', exact: true }).click();
    await expect(vscode.window.getByText(/MCP connection verified:/).first()).toBeVisible();
    await expect(screen.locator('#status')).toHaveText('Waiting for an assistant');
    await screen.getByLabel('Enable AI connection', { exact: true }).uncheck();
    await expect(screen.locator('#status')).toHaveText('AI connection disabled');
    await expect(screen.getByLabel('Token', { exact: true })).toHaveValue('');
    await expect.poll(async () => {
      try {
        await fetch(url);
        return false;
      } catch {
        return true;
      }
    }).toBe(true);
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await vscode.commands.executeCommand('shader-studio.connectAiAssistant');
    });
    const reopened = await findConnectionScreen(vscode);
    await expect(reopened.locator('#status')).toHaveText('AI connection disabled');
  } finally {
    await client.close();
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.workspace.getConfiguration('shader-studio').update('mcpEnabled', false, vscode.ConfigurationTarget.Global);
      await vscode.env.clipboard.writeText('');
    });
  }
});

test('survives repeated client disconnects without resetting the AI connection', async ({ vscode }) => {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  await vscode.evaluateInHost(async (vscode, port) => {
    const config = vscode.workspace.getConfiguration('shader-studio');
    await config.update('mcpEnabled', false, vscode.ConfigurationTarget.Global);
    await config.update('mcpPort', port, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('shader-studio.connectAiAssistant');
  }, port);
  const screen = await findConnectionScreen(vscode);
  await screen.getByLabel('Enable AI connection', { exact: true }).check();
  await expect(screen.locator('#status')).toHaveText('Waiting for an assistant');
  const url = await screen.getByLabel('Server URL', { exact: true }).inputValue();
  const token = await screen.getByLabel('Token', { exact: true }).inputValue();
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const live = new Client({ name: 'session-survivor', version: '1' });
  try {
    await live.connect(transport);
    await live.listTools();
    for (let index = 0; index < 40; index++) {
      const departing = new Client({ name: 'client-that-exits', version: '1' });
      const connection = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
      try {
        await departing.connect(connection);
        await departing.listTools();
      } finally {
        // Reproduce clients that close/crash without sending HTTP DELETE.
        await departing.close();
      }
    }
    await expect(live.listTools()).resolves.toHaveProperty('tools');
    await screen.locator('summary').click();
    await screen.getByRole('button', { name: 'Check server', exact: true }).click();
    await expect(vscode.window.getByText(/MCP connection verified:/).first()).toBeVisible();
    await expect(screen.locator('#status')).toHaveText('Assistant connected');
  } finally {
    await transport.terminateSession().catch(() => undefined);
    await live.close();
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.workspace.getConfiguration('shader-studio').update('mcpEnabled', false, vscode.ConfigurationTarget.Global);
      await vscode.env.clipboard.writeText('');
    });
  }
});
