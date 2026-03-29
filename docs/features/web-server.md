# Open in Browser


## Goal

Run your shader preview in a browser tab for full-screen viewing, performance testing, or working in a browser instead of the VS Code panel.

## Steps

1. Open the options menu (<i class="codicon codicon-menu"></i>).
2. Click **Web Server** to start the HTTP server.
3. A green dot appears next to "Web Server" when it's running.
4. Click **Web Server** again to open the menu with options:
    - **Open in Browser** — launch in your default browser
    - **Copy URL** — copy `http://localhost:PORT` to clipboard
    - **Stop Server** — shut down the server

![Web server running with browser](../assets/placeholders/template.svg)
_Placeholder: `workflow-web-server.png` — Split view showing the VS Code preview on one side and a browser tab with the same shader running at localhost._

You can also use the command palette:

- **Shader Studio: Start Web Server**
- **Shader Studio: Stop Web Server**

## Live Sync

The browser preview stays in sync with VS Code via WebSocket. When you edit your shader in VS Code, the browser preview updates automatically — no manual refresh needed.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `shader-studio.webServerPort` | `3000` | HTTP port the server runs on |
| `shader-studio.webSocketPort` | `51472` | WebSocket port for live updates (requires VS Code restart after change) |

Both ports must be in the range 1024–65535.

## Features

- **Hot reloading** — shader changes sync instantly via WebSocket
- **Texture and video serving** — all referenced assets are served automatically
- **Video range requests** — supports HTTP 206 partial content for video scrubbing
- **Cross-origin support** — full CORS headers for embedding

## Tips

- The browser preview runs at the browser's native frame rate, which may differ from the VS Code panel
- Use browser developer tools for GPU profiling and performance analysis
- Multiple browser tabs can connect to the same server simultaneously
- If the connection drops, refresh the browser tab to reconnect

## Related

- [Settings](../help/settings.md)
