/** Static connection UI. Credentials arrive only through private webview messages. */
export function mcpConnectionHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>AI connection</title>
<style nonce="${nonce}">
body { max-width: 660px; margin: 40px auto; padding: 0 24px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
h1 { font-size: 26px; font-weight: 500; margin-bottom: 8px; } h2 { font-size: 16px; font-weight: 500; }
p { line-height: 1.6; } .muted { color: var(--vscode-descriptionForeground); }
section, details { margin-top: 24px; border-top: 1px solid var(--vscode-widget-border, #6666); padding-top: 20px; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid transparent; padding: 8px 12px; cursor: pointer; border-radius: 3px; }
button:hover { background: var(--vscode-button-hoverBackground); } button:disabled { opacity: .5; cursor: default; }
button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0 18px; }
.field { flex-wrap: nowrap; } input[type="text"], input[type="password"] { min-width: 0; flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border, #6666); background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: var(--vscode-editor-font-family); }
label { display: block; } .toggle { display: flex; gap: 8px; align-items: center; font-size: 16px; }
#status { font-weight: 600; } #notice { min-height: 22px; } summary { cursor: pointer; }
@media (max-width: 480px) { body { margin-top: 20px; } .field { flex-wrap: wrap; } .field input { flex-basis: 100%; } }
</style></head><body>
<h1>AI connection</h1>
<p class="muted">Connect your assistant to edit shaders, inspect errors, and see your running preview.</p>
<label class="toggle"><input id="enabled" type="checkbox"> Enable AI connection</label>
<p id="status" role="status" aria-live="polite">Loading connection…</p>
<p id="detail" class="muted"></p>
<section aria-label="Connection details">
<label for="url">Server URL</label>
<div class="row field"><input id="url" type="text" readonly spellcheck="false"><button id="copyUrl" disabled>Copy URL</button></div>
<label for="token">Token</label>
<div class="row field"><input id="token" type="password" readonly autocomplete="off"><button id="reveal" class="secondary" disabled>Show token</button><button id="copyToken" disabled>Copy token</button></div>
<p class="muted">In your assistant’s MCP settings, choose Streamable HTTP. Use this token for Bearer authentication, or an Authorization header with the value “Bearer TOKEN”.</p>
<h2>Let your assistant help with setup</h2>
<button id="copyPrompt" disabled>Copy setup prompt</button>
<p class="muted">Paste the prompt into a local assistant that can configure MCP. It includes your private token. Your assistant may need a restart before the tools become available.</p>
<div id="notice" role="status" aria-live="polite"></div>
</section>
<details><summary>Advanced settings</summary>
<p class="muted">Connection status counts initialized MCP sessions. Idle sessions expire after 30 minutes and may be reclaimed sooner when other assistants connect. Reconnect your assistant if its session expires. Open streams and requests in progress are kept.</p>
<div class="row"><button id="port" class="secondary">Change port</button><button id="verify" class="secondary" disabled>Check server</button><button id="regenerate" class="secondary" disabled>Regenerate token</button></div>
</details>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const element = id => document.getElementById(id);
element('enabled').addEventListener('change', event => { vscode.postMessage({ action: 'setEnabled', enabled: event.target.checked }); });
for (const action of ['copyUrl', 'copyToken', 'copyPrompt', 'port', 'verify', 'regenerate']) {
  element(action).addEventListener('click', () => vscode.postMessage({ action }));
}
element('reveal').addEventListener('click', () => {
  const visible = element('token').type === 'password';
  element('token').type = visible ? 'text' : 'password';
  element('reveal').textContent = visible ? 'Hide token' : 'Show token';
});
window.addEventListener('message', event => {
  const state = event.data;
  if (state.type === 'notice') { element('notice').textContent = state.text; return; }
  if (state.type !== 'state') return;
  element('enabled').checked = state.enabled;
  element('enabled').disabled = !state.trusted && !state.enabled;
  element('status').textContent = state.status;
  element('detail').textContent = state.detail;
  element('url').value = state.url;
  if (element('token').value !== state.token) {
    element('token').type = 'password'; element('reveal').textContent = 'Show token';
  }
  element('token').value = state.token;
  for (const action of ['copyUrl', 'copyToken', 'copyPrompt', 'reveal', 'verify', 'regenerate']) element(action).disabled = !state.ready;
});
vscode.postMessage({ action: 'ready' });
</script></body></html>`;
}
