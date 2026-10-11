# Local MCP access

Shader Studio exposes a local Model Context Protocol (MCP) endpoint so compatible
AI agents can read and edit workspace files, inspect compiler diagnostics, control
playback, and see PNG images from a running shader preview.

## Enable once

MCP is **disabled by default**. In VS Code's **User** settings:

1. Enable **Shader Studio: Mcp Enabled**.
2. Copy the automatically generated **Shader Studio: Mcp Token** into your agent's
   local MCP configuration. You can supply your own token of at least 16 characters.
3. Open a Shader Studio preview when you want the agent to inspect rendered output.

Shader Studio starts the endpoint immediately and automatically starts it again
at every VS Code startup while the setting is enabled. It keeps running for the
extension session, including when no preview is open. Disable the setting to stop
the endpoint and disconnect clients. Changing the token or port restarts it.
Workspace trust is required. No extra helper, terminal process, remote service,
or agent-specific connection button is needed.

The default address is `http://127.0.0.1:51474/mcp`. Change **Shader Studio: Mcp Port**
in that workspace's settings if another VS Code window is already using that
port. Enablement and the token are user settings; never commit the token.

## Connect an agent

Configure any client that supports **Streamable HTTP MCP** with:

| Field | Value |
| --- | --- |
| Server name | `shader-studio` |
| URL | `http://127.0.0.1:51474/mcp` |
| HTTP header | `Authorization: Bearer YOUR_PRIVATE_TOKEN` |

For clients using JSON server configuration, the equivalent is:

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

Use your client's documented names for URL and header settings if they differ.
The server uses a local bearer token, without an OAuth flow. Clients must run on
the same computer; a hosted agent cannot reach your loopback address.

For Codex, add the server URL and a bearer-token environment variable to its MCP
configuration. For example:

```toml
[mcp_servers.shader_studio]
url = "http://127.0.0.1:51474/mcp"
bearer_token_env_var = "SHADER_STUDIO_MCP_TOKEN"
```

Set `SHADER_STUDIO_MCP_TOKEN` in the environment used to launch your client to the
same token configured in Shader Studio. Keep credentials out of shared config.

## Files drive the preview

Shader source and persistent configuration are edited through their files.
There is no separate shader override. Use `read_file` and `update_file` for shaders,
`.sha.json` configs, includes, pass files, and scripts. `get_settings` returns the
configuration file path, text, and revision when a config exists.

`update_file` requires the revision from the latest read, protecting newer user
or agent edits. It applies an undoable VS Code editor edit and leaves the document
unsaved. Save in VS Code when you want it written to disk. Only existing local
text files of up to 1 MB in the workspace or already-open documents are supported;
Git internals, directories, binary documents, and escapes through symlinks are
rejected. File creation and deletion are outside these tools.

Normal preview updates follow file edits. To wait for an edited project's compile,
pass `previewId` to `update_file`. Add `includePreview: true` to also return fresh
PNG pixels. After an edit that fails compilation, inspect errors and compare
`compileSequence` with `renderedSequence`: the renderer may still show its last
good program. An `applied: true` result with `previewError` means the file edit
already succeeded; do not blindly retry the same edit.

`update_settings` changes runtime FPS limit, time speed, or custom uniform values.
Uniform overrides are temporary and a running script can replace them. Persistent
settings always go through the config file. Seeking time does not reconstruct
simulation history; reset separately when needed.

## Available tools

| Tool | Purpose |
| --- | --- |
| `list_previews` | Discover connected VS Code panels and browser previews |
| `get_resources` | Discover render, common, buffer and compute passes, source paths, and storage declarations |
| `read_storage` | Read a bounded range of actual GPU storage values as raw bytes with type and stride |
| `get_logs` | Read extension, script console and viewer diagnostic logs with a continuation cursor |
| `list_files` | Find workspace files using an optional glob |
| `read_file` | Read current editor text, dirty state, and revision |
| `update_file` | Apply a revision-checked file edit, optionally await output |
| `get_shader` | Read the selected preview's shader file |
| `get_settings` | Read the config file and runtime viewer state |
| `update_settings` | Change temporary runtime viewer controls |
| `get_diagnostics` | Read preview errors, warnings, and compile markers |
| `capture_output` | Render a frame and return PNG image content; feedback buffers can advance |
| `set_playback` | Pause, resume, seek time, or reset |

When exactly one preview is open, `previewId` can be omitted. With multiple
previews, call `list_previews` and select one explicitly. Requests target that
connection, rather than broadcasting to every viewer. Closed or unresponsive
previews produce an actionable error.

Buffer and compute passes use the same `read_file` / `update_file` workflow as
the Image shader. Use `get_resources` to find their paths. Dispatch settings,
pass inputs and storage declarations are edited in the `.sha.json` file.

`read_storage` reads live WebGPU storage for Slang or WGSL. Supply its `name`,
zero-based element `start`, and `count` (1–1024). Reads are capped at 64 KiB before
GPU staging allocation. The result includes byte values, element type, stride,
range, and preview frame/time metadata. Decode each element using its declared
layout; padding is preserved. Pause playback first for stable inspection across
multiple reads. GLSL/WebGL reports that storage readback is unsupported.

`get_logs` retains the latest 500 entries, each limited to 4096 characters. It
includes extension logs, script `console.log/info/debug/warn/error`, and viewer
log/debug/warning/error messages. Filter by exact `level` or `previewId`; global
extension and script entries remain included with a preview filter. Pass
`nextCursor` back as `after` to continue reading. `hasMore` indicates another
page, and `droppedBeforeCursor` reports that older entries expired. The tool
does not expose unrelated VS Code extension logs or the browser's entire console.

An example agent prompt:

> Use Shader Studio's MCP tools to find my preview. Read its shader and config
> files, make a revision-checked file edit, then inspect diagnostics and capture
> the updated output. Keep changes in the editor for me to review.

## Browser previews and the web server

VS Code panels and previews opened through **Shader Studio: Start Web Server**
use the same MCP tools and viewer protocol. Starting the web server also exposes
the same authenticated endpoint at `http://127.0.0.1:WEB_SERVER_PORT/mcp` while
MCP is enabled. You can use either that address or the dedicated MCP port.

No separate process is needed for a browser preview. The extension owns the files
and MCP endpoint; the viewer receives commands through its existing transport.
A static standalone site or a generic static-file server does not provide this
endpoint or access to VS Code documents.

## Troubleshooting

- **Cannot connect:** check that MCP is enabled, the workspace is trusted, and the
  client URL uses the configured port. Check Shader Studio's output log for startup
  errors, including a port already in use.
- **401:** configure the same bearer token on both sides.
- **No preview:** open a Shader Studio panel or extension-hosted browser preview.
  File tools work without a preview.
- **Multiple previews:** use the ID returned by `list_previews`.
- **File changed:** read the file again and use the new revision.
- **Session expired:** reconnect the client after a restart or settings change.
- **Preview timed out:** make the viewer visible and responsive, then retry the
  read or capture. Check whether an earlier edit was already applied first.

The endpoint binds only to `127.0.0.1`, validates local Host/Origin headers, and
requires the token for every request. Keep the token private: local clients with
it can inspect and edit the files this VS Code session exposes.
