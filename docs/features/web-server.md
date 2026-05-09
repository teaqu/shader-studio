# Open in Browser

Run your shader preview in a browser tab for full-screen viewing or working in a browser instead of the VS Code panel.

## Steps

1. Click the **Shader Studio** icon in the VS Code status bar.
2. Click **Start Web Server**.
3. A green dot appears on the status bar icon when the server is running.
4. Click the **Shader Studio** icon again and select **Open in Browser**.

You can also use the command palette:

- **Shader Studio: Start Web Server**
- **Shader Studio: Stop Web Server**
- **Shader Studio: Open in Browser**

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `shader-studio.webServerPort` | `3000` | HTTP port the server runs on |

Port must be in the range 1024–65535.

## Light and Dark Mode

The browser preview supports both light and dark themes, independent of your VS Code theme. Open the toolbar's **Menu → Options** and select **Dark Mode** or **Light Mode** to switch.

## Tips

- The browser preview can sometimes achieve better performance due to browser optimisations
- The browser preview runs at the browser's native frame rate, which may differ from the VS Code panel
- Multiple browser tabs can connect to the same server simultaneously
- If the connection drops, refresh the browser tab to reconnect

## Next

[Shader Explorer](shader-explorer.md) — browse and preview all shaders in your workspace
