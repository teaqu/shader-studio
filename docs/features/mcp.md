# Connect an AI Assistant

Connect a compatible AI assistant to Shader Studio so it can help edit your shaders, explain errors, inspect values, and see images from your running preview. The connection uses Model Context Protocol (MCP), a standard supported by many AI tools.

This feature requires the **VS Code extension**, a trusted workspace, and an AI tool with a **Streamable HTTP MCP** client running on the same computer. It works with previews in VS Code and previews opened from VS Code in your browser. The standalone browser app does not provide this connection.

## Enable the Connection

MCP is disabled by default.

1. Open VS Code **Settings** and search for `shader-studio.mcp`.
2. In **User** settings, enable **Shader Studio: Mcp Enabled**.
3. Copy the automatically generated **Shader Studio: Mcp Token**. Keep it private: an assistant connected with this token can read and edit files available to your VS Code session.
4. Open the shader you want help with and launch its Shader Studio preview.

Once enabled, the connection starts automatically when you launch VS Code. You do not need to run a separate helper program. Turn off **Mcp Enabled** to disconnect assistants and stop access. If you change the token or port, reconnect your assistant using the new settings.

## Set Up Your Assistant

In your AI tool's MCP settings, add a server with these values:

| Setting | Value |
| --- | --- |
| Name | `shader-studio` |
| Connection type | Streamable HTTP |
| Server URL | `http://127.0.0.1:51474/mcp` |
| Authorization header | `Authorization: Bearer YOUR_PRIVATE_TOKEN` |

Replace `YOUR_PRIVATE_TOKEN` with the token from VS Code. If your tool accepts JSON configuration, this is a common format:

```json
{
  "mcpServers": {
    "shader-studio": {
      "url": "http://127.0.0.1:51474/mcp",
      "headers": { "Authorization": "Bearer YOUR_PRIVATE_TOKEN" }
    }
  }
}
```

The exact setting names vary by AI tool; follow its instructions for adding a Streamable HTTP server and authorization header. Keep the token in private local settings, outside shared shader projects.

If another VS Code window is already using port `51474`, set **Shader Studio: Mcp Port** to an unused port in this workspace, then use that port in the server URL. A client running on another computer cannot use this local address.

## Ask for Help with a Shader

Try a request like:

> Look at my Shader Studio preview and explain how the effect works. Make the colors warmer, check for errors, and show me the updated result. Leave the edits open for me to review.

You can also ask the assistant to:

- Find and explain a compilation error.
- Edit a buffer or compute shader and inspect its effect on the final image.
- Pause the preview and compare values in a Slang or WGSL storage buffer.
- Adjust playback speed or try a temporary custom-uniform value.
- Capture a PNG of the current shader output.

If several previews are open, tell the assistant which shader you want to work on. It can list the previews and select the appropriate one. File editing still works when no preview is open; viewing the rendered result requires an open, responsive preview.

## Review and Save Edits

The assistant edits your existing shader files and `.sha.json` configuration in VS Code. Changes remain **unsaved**, and you can review or undo them in the editor. Save the files when you want to keep the changes on disk. These tools do not create or delete files.

File editing supports local text files up to 1 MB in your workspace or already open in VS Code. Binary assets cannot be edited with these tools. If a file has changed since the assistant read it, it must read the latest version before editing again.

The assistant can wait for compilation and request an updated image after an edit. If compilation fails, the preview may still show the last successful result; ask it to check the errors before evaluating the image. A failed image request does not undo an edit that has already been applied.

Playback and uniform adjustments made through the connection are temporary. A running Script pass may replace a temporary uniform value. To keep a change with the shader, ask the assistant to edit its configuration or script. Seeking to a time does not replay earlier simulation steps; use **Reset** when you need to restart a simulation.

## Tools Available to Your Assistant

You do not need to call these tools yourself. This reference explains what your assistant can do after connecting.

| Tool | Purpose |
| --- | --- |
| `list_previews` | Find open VS Code and browser previews |
| `list_files` | Find files in your workspace |
| `read_file` / `update_file` | Read or edit an existing text file, checking for intervening changes |
| `get_shader` | Read the shader shown in a selected preview |
| `get_resources` | Find the shader's passes, associated files, and storage buffers |
| `get_settings` | Read the shader configuration and current preview settings |
| `update_settings` | Try temporary playback, frame-rate, or uniform settings |
| `get_diagnostics` / `get_logs` | Read shader errors, warnings, and Shader Studio or Script messages |
| `capture_output` | Capture a PNG of the rendered result |
| `set_playback` | Pause, resume, seek, or reset the shader |
| `read_storage` | Inspect a range of values in a Slang or WGSL storage buffer |

Capturing an image can advance feedback buffers. For stable comparisons of storage values, pause playback before inspecting them. Storage reads return up to 1,024 elements and 64 KiB at a time; GLSL storage inspection is unavailable.

## Use a Browser Preview

Start Shader Studio's web server from the VS Code status-bar menu, then choose **Open in Browser**. Your assistant can inspect that preview through the same connection while you continue editing in VS Code.

While MCP is enabled, the web server also accepts connections at `http://127.0.0.1:WEB_SERVER_PORT/mcp`. Replace `WEB_SERVER_PORT` with your configured web server port and use the same token. The dedicated MCP address above continues to work too.

See [Open in Browser](web-server.md) for the preview setup.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Cannot connect | Check that MCP is enabled, your workspace is trusted, and the URL uses the configured port. Open VS Code's **Output** panel and choose **Shader Studio** for startup errors. |
| Port already in use | Choose another **Mcp Port** for this workspace and update your assistant's URL. |
| Unauthorized / 401 | Copy the current **Mcp Token** into your assistant's authorization header. |
| No preview found | Open a Shader Studio panel or a browser preview launched from VS Code. |
| Wrong preview | Ask the assistant to list previews and select the shader you mean. |
| File changed | Ask the assistant to read the file again before making the edit. |
| Session expired | Reconnect after restarting VS Code or changing connection settings. |
| Preview timed out | Make the preview visible, check for errors, and try the image request again. Check whether the file edit already succeeded before repeating it. |
