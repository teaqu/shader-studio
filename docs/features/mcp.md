# Connect an AI Assistant

Connect a compatible AI assistant to Shader Studio so it can help edit your shaders, explain errors, inspect values, and see images from your running preview. The connection uses Model Context Protocol (MCP), a standard supported by many AI tools.

This feature requires the **VS Code extension**, a trusted workspace, and an AI tool with a **Streamable HTTP MCP** client running on the same computer. It works with previews in VS Code and previews opened from VS Code in your browser. The standalone browser app does not provide this connection.

## Enable the Connection

MCP is disabled by default.

1. Run **Shader Studio: Connect AI Assistant** from the Command Palette.
2. Enable MCP if prompted. The command shows whether the local endpoint is ready and offers client-specific configuration commands.
3. Copy a client configuration with **Shader Studio: Copy Codex MCP Configuration** or **Shader Studio: Copy Claude Code MCP Configuration**. Keep the copied token private: an assistant connected with it can read and edit files available to your VS Code session.
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

Replace `YOUR_PRIVATE_TOKEN` with the token copied by **Shader Studio: Copy Claude Code MCP Configuration**. Claude Code's local HTTP configuration is:

```json
{
  "mcpServers": {
    "shader-studio": {
      "type": "http",
      "url": "http://127.0.0.1:51474/mcp",
      "headers": { "Authorization": "Bearer YOUR_PRIVATE_TOKEN" }
    }
  }
}
```

For Codex, save the copied block in `~/.codex/config.toml`. Update an existing `shader-studio` block if one is present, then restart its MCP server from Codex settings:

```toml
[mcp_servers.shader-studio]
url = "http://127.0.0.1:51474/mcp"
http_headers = { Authorization = "Bearer YOUR_PRIVATE_TOKEN" }
```

For Claude Code, merge the copied `mcpServers` entry into `~/.claude.json` for user scope, preserving any existing settings and servers. Restart Claude Code and use `/mcp` to check the connection. Keep the token outside shared shader projects. See [Claude Code's MCP scopes](https://code.claude.com/docs/en/mcp#user-scope).

Restart or reload the assistant after adding the server. Run **Shader Studio: Verify MCP Connection** to confirm the local endpoint accepts the current token, then ask the assistant to list Shader Studio previews; opening a preview first gives it a result to inspect. If another VS Code window is already using port `51474`, set **Shader Studio: Mcp Port** to an unused port in this workspace, then copy the configuration again. A client running on another computer cannot use this local address.

The token is stored in VS Code Secret Storage. Use **Shader Studio: Regenerate MCP Token** if it was exposed, then copy fresh local client configuration and reconnect. Do not put a token in a shared workspace setting or repository.

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

`get_inputs` is a live-preview snapshot, not a frozen per-pass GPU capture. It reports built-ins available for the selected preview and identifies values unavailable for that view. When playback is paused, each custom uniform can include its `pausedValue`; it is `null` while playback is running. Custom uniform defaults and ranges are reported as unknown when the Script API has not declared them.

## Tools Available to Your Assistant

You do not need to call these tools yourself. This reference explains what your assistant can do after connecting.

| Tool | Purpose |
| --- | --- |
| `list_previews` | Find open VS Code and browser previews |
| `list_files` | Find files in your workspace |
| `read_file` / `update_file` | Read or edit an existing text file, checking for intervening changes |
| `get_shader` | Read the shader shown in a selected preview |
| `get_resources` | Find the shader's passes, associated files, and storage buffers |
| `get_inputs` | Inspect current live preview inputs and whether a Script pass may overwrite a temporary custom-uniform value |
| `get_settings` | Read the shader configuration and current preview settings |
| `update_settings` | Try temporary playback, frame-rate, or uniform settings |
| `get_diagnostics` | Read current shader errors and warnings |
| `start_log_collection` / `get_logs` / `stop_log_collection` | Explicitly collect and read a bounded diagnostic log |
| `capture_output` | Capture a PNG of the rendered result |
| `set_playback` | Pause, resume, seek, or reset the shader |
| `read_storage` | Inspect a range of values in a Slang or WGSL storage buffer |
| `read_documentation` | Read bundled, version-matched MCP, uniforms, pass, channel, compute, storage, and render-output reference topics |
| `create_file` | Create a new workspace text file when it does not already exist |
| `select_shader` | Switch one explicitly selected preview to a shader path |
| `inject_input` | Send canonical pointer and keyboard input events to one explicitly selected preview |
| `start_input_recording` / `stop_input_recording` / `get_input_recording` | Capture and inspect a bounded timeline of live input events |
| `replay_inputs` / `get_input_replay` / `cancel_input_replay` | Replay a recorded input timeline and inspect or cancel it |
| `read_feedback` | Read a bounded feedback/pass pixel region when the selected backend exposes it |
| `start_recording` / `stop_recording` / `get_recording` | Create and monitor a bounded live MP4 or WebM recording; completed artifacts are returned as MCP resources |
| `start_frame_capture` / `get_frame_capture` / `cancel_frame_capture` | Capture up to eight PNG frames at requested wall-clock offsets, without creating a video |

Capturing an image can advance feedback buffers. For stable comparisons of storage values, pause playback before inspecting them. Storage reads return up to 1,024 elements and 64 KiB at a time; GLSL storage inspection is unavailable.

WebGL `read_feedback` returns the latest published feedback buffer as up to 4,096 RGBA pixels (64 KiB of float data), using a bottom-left origin. Finite samples are JSON numbers; non-finite samples are the strings `NaN`, `Infinity`, or `-Infinity`. WebGPU uses the separate `read_storage` tool for numerical storage inspection.

## Input Automation and Recordings

MCP preview tracking is active only while MCP is enabled in a trusted workspace. Disabling MCP detaches existing previews, cancels pending requests, and clears collected logs. Enabling it again discovers previews that are already open.

Log collection is off by default, even with MCP enabled. Ask the assistant to call `start_log_collection` before reproducing a problem, then `get_logs` to inspect it. Collection automatically stops after 60 seconds by default; `duration` accepts 1–300 seconds. `stop_log_collection` ends it early. Reads never start or extend collection. One shared collection retains at most 500 messages of up to 4,096 characters each in memory; starting again clears the previous history. Stopped or expired results remain readable until the next start or until MCP is disabled. `previewId` filters viewer messages while still including extension and Script messages. Shader Studio's ordinary output and Script console behavior remain available independently of MCP collection.

Screenshots, timed frames, videos, and input traces are captured only when explicitly requested. Merely enabling MCP or listing previews does not capture them.

Input injection, replay, feedback reads, and video recording always require an explicit `previewId` from `list_previews`. This avoids sending interaction to the wrong preview when several are open. Input events use canonical `pointer_move`, `pointer_down`, `pointer_up`, `key_down`, `key_up`, and `release_all` records (up to 256 events per injection); pointer movement and down events require coordinates, while key events require a key code.

An input recording captures interaction delivered to the selected preview. Replay can reset before it starts, but seeking cannot recreate feedback-buffer history. Use reset and replay from the beginning when comparing a simulation. A preview switch or recompilation is reported in recording metadata.

`replay_inputs` uses the selected preview’s last input trace. Choose `from-current` to keep the current simulation state or `reset-and-play` to reset first. `start_recording` makes a Live MP4 or WebM artifact for 0.1–60 seconds at 1–60 fps and up to 1920×1080. Set `recordInputs` to preserve the paired input trace. Its output size does not resize the preview or reset its feedback state. `get_recording` reports output availability, requested and actual settings, frame timestamps, shader path, compile and render sequences, plus preview-switch and recompile flags. Actual dropped-frame statistics are `null` when the browser encoder cannot provide them. Read the completed `shader-studio://recordings/ID` resource (or the resource link returned by the tool) to retrieve the bounded artifact.

Recording storage retains the ten newest completed videos, with a 32 MiB limit per video. Saving another recording deletes older completed videos and abandoned recording `.part` files older than 24 hours, including leftovers from a previous extension session. Recent partial transfers are preserved for other open VS Code windows. Timed PNG capture jobs stay in preview memory and retain only three completed jobs.

`start_frame_capture` accepts one to eight sorted, unique requested offsets from 0 to 60 seconds and captures PNGs at up to 1920×1080 (800×450 by default). The job uses real elapsed wall time: each returned frame includes its requested timestamp and its actual elapsed timestamp, which can differ when rendering is late. It never seeks, so feedback advances naturally. Choose `reset-and-play` only when a fresh simulation is wanted; it performs a real reset and resume before capture. Completed frame images appear in requested-time order in the MCP response; metadata excludes image bytes.

## Use a Browser Preview

Start Shader Studio's web server from the VS Code status-bar menu, then choose **Open in Browser**. Your assistant can inspect that preview through the same connection while you continue editing in VS Code.

While MCP is enabled, the web server also accepts connections at `http://127.0.0.1:WEB_SERVER_PORT/mcp`. Replace `WEB_SERVER_PORT` with your configured web server port and use the same token. The dedicated MCP address above continues to work too.

See [Open in Browser](web-server.md) for the preview setup.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Cannot connect | Check that MCP is enabled, your workspace is trusted, and the URL uses the configured port. Open VS Code's **Output** panel and choose **Shader Studio** for startup errors. |
| Port already in use | Choose another **Mcp Port** for this workspace and update your assistant's URL. |
| Unauthorized / 401 | Run **Shader Studio: Copy Codex MCP Configuration** or **Copy Claude Code MCP Configuration**, replace the local client block, then restart or reload the client. |
| No preview found | Open a Shader Studio panel or a browser preview launched from VS Code. |
| Wrong preview | Ask the assistant to list previews and select the shader you mean. |
| File changed | Ask the assistant to read the file again before making the edit. |
| Session expired | Reconnect after restarting VS Code or changing connection settings. |
| Preview timed out | Make the preview visible, check for errors, and try the image request again. Check whether the file edit already succeeded before repeating it. |
