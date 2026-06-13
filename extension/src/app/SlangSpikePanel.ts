import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * THROWAWAY dev-only spike. Opens the Slang→WebGPU harness inside a real
 * extension webview to answer the one open question for Option B: does the
 * VS Code (Electron) webview expose `navigator.gpu`?
 *
 * Loads files straight from spike/slang-webgpu/ via webview URIs. Not shipped —
 * the spike folder doesn't exist in a packaged build, and the command no-ops
 * with a clear message if it's missing.
 */
export function openSlangSpikePanel(context: vscode.ExtensionContext): void {
  const spikeDir = path.join(context.extensionPath, "..", "spike", "slang-webgpu");
  const mainJs = path.join(spikeDir, "main.js");

  if (!fs.existsSync(mainJs)) {
    vscode.window.showErrorMessage(
      `Slang spike not found at ${spikeDir}. This is a dev-only command.`,
    );
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "slang-spike",
    "Slang → WebGPU spike",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(spikeDir)],
    },
  );

  const uri = (rel: string) =>
    panel.webview.asWebviewUri(vscode.Uri.file(path.join(spikeDir, rel)));

  // main.js imports ./vendor/slang-wasm.js relative to its own URL, so only the
  // entry script needs an explicit webview URI.
  const mainUri = uri("main.js");
  const cspSource = panel.webview.cspSource;

  // The webview resource server returns an empty body for .slang, so read it
  // here and embed it. A type="text/plain" block isn't executed, so it's not
  // subject to script-src — no nonce needed. Escape to keep the markup intact.
  const slangSource = fs
    .readFileSync(path.join(spikeDir, "shader.slang"), "utf-8")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");

  // WebGPU is not gated by CSP. slang-wasm's emscripten loader evaluates a
  // string as JS, so it needs 'unsafe-eval' (the real shader panel already
  // allows this for custom-uniform script eval). connect-src covers fetching
  // the .wasm and .slang source.
  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src ${cspSource} 'wasm-unsafe-eval' 'unsafe-eval'`,
    `connect-src ${cspSource}`,
    `font-src ${cspSource}`,
  ].join("; ");

  panel.webview.html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Slang → WebGPU spike</title>
    <style>
      body { margin: 0; font-family: ui-monospace, Menlo, Consolas, monospace; background: #14141a; color: #e6e6e6; display: grid; grid-template-columns: 460px 1fr; height: 100vh; }
      #left { padding: 16px; overflow: auto; border-right: 1px solid #2a2a35; }
      #right { display: flex; align-items: center; justify-content: center; background: #0c0c10; }
      canvas { width: 480px; height: 480px; background: #000; }
      h1 { font-size: 14px; margin: 0 0 12px; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: bold; }
      .ok { background: #143d2a; color: #5fe3a1; }
      .bad { background: #44161a; color: #ff8a93; }
      #log { white-space: pre-wrap; font-size: 12px; line-height: 1.5; margin: 12px 0; }
      .step { color: #8a8a99; }
      .step.done::before { content: "✓ "; color: #5fe3a1; }
      .step.fail::before { content: "✗ "; color: #ff8a93; }
      pre { background: #0c0c10; padding: 10px; border-radius: 6px; overflow: auto; font-size: 11px; max-height: 300px; }
    </style>
  </head>
  <body>
    <div id="left">
      <h1>Slang → WebGPU spike (VS Code webview)</h1>
      <div>WebGPU: <span id="gpu" class="badge bad">checking…</span></div>
      <div id="log"></div>
      <details open><summary>Generated WGSL</summary><pre id="wgsl">—</pre></details>
    </div>
    <div id="right"><canvas id="c" width="480" height="480"></canvas></div>
    <script type="text/plain" id="slang-src">${slangSource}</script>
    <script type="module" src="${mainUri}"></script>
  </body>
</html>`;
}
