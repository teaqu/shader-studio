# Troubleshooting


## Preview Is Blank

- Confirm your shader has the correct signature: `void mainImage(out vec4 fragColor, in vec2 fragCoord)`
- Check the error tooltip near the play/pause button — a red indicator means compilation failed
- Try **Refresh** from the options menu
- Make sure the file extension is `.glsl`

## Shader Has Errors But Code Looks Correct

- Check that all referenced uniforms are available (`iTime`, `iResolution`, etc. — see [compatibility](shadertoy-compatibility.md))
- If using multi-pass, ensure the `.sha.json` config is valid and buffer file paths exist
- Check that `iChannel0–3` are bound in the config if you're using `texture()` calls

## Config Changes Not Applying

- Ensure the config filename matches the shader basename: `name.glsl` + `name.sha.json`
- Both files must be in the same directory
- Verify that referenced buffer `.glsl` files exist at the specified paths
- Reopen the preview or click **Refresh** from the options menu

## Browser Mode Not Connecting

- Start the web server from the toolbar menu → **Web Server** and open it in your browser
- Verify ports in settings: `webServerPort` (default 3000) and `webSocketPort` (default 51472)
- If you changed the WebSocket port, restart the VS Code window
- Check that the ports aren't in use by another application
- Try refreshing the browser tab

## Debug Mode Not Updating

- Confirm debug mode is enabled (<i class="codicon codicon-bug"></i> should be highlighted in toolbar)
- Place your cursor on a supported line: declarations, assignments, compound assignments, member access, or return statements
- Disable **line lock** if the visualization is stuck on one line
- Check the line number in the debug panel header — red text means no variable was found on that line

## Editor Overlay Not Showing Changes

- The overlay has a 30ms debounce — wait briefly for the preview to update
- Check that the file is saved (500ms auto-save debounce)
- If switching buffers, ensure the correct buffer tab is active

## Snippet Library Missing

- Check that `shader-studio.enableSnippets` is enabled in settings
- Reload the VS Code window after changing this setting

## Shader Explorer Shows No Shaders

- Ensure your workspace contains `.glsl` files
- Try the **refresh** button in the explorer
- Check the search bar isn't filtering out your shaders
- If "Hide Failed" is checked, uncheck it to see all shaders
