# Interface Tour


This page maps the controls in the preview toolbar and their functions.

## Main Toolbar (Left Side)

![Main toolbar](assets/placeholders/template.svg)
_Placeholder: `interface-toolbar.png` — Left side of the preview toolbar showing compile, reset, play/pause, time, FPS, and resolution controls._

| Control | Description |
|---------|-------------|
| <i class="codicon codicon-run-all"></i> **Compile Now** | Appears only in manual compile mode. Runs the compiler immediately (`Ctrl+Enter`). |
| <i class="codicon codicon-debug-restart"></i> **Reset** | Restart shader state and time to 0 |
| <i class="codicon codicon-play"></i> / <i class="codicon codicon-debug-pause"></i> **Play/Pause** | Freeze or resume animation. Shows an error indicator if the shader has compilation errors. |
| **Time** | Current time in seconds. Click to expand the [time controls](features/time-controls.md) menu with scrubbing, looping, and speed. |
| **FPS** | Live frame rate display. Click to open the FPS menu. |
| **Resolution** | Canvas dimensions. Click to open the resolution menu. |

### FPS Menu

Click the FPS display to access:

![FPS menu](assets/placeholders/template.svg)
_Placeholder: `interface-fps-menu.png` — FPS menu expanded with frame rate limit options and the frame times toggle._

- **Frame rate limit**: Unlimited, 60 fps, or 30 fps
- **Frame Times**: Toggle the [performance monitor](features/performance.md) panel

### Resolution Menu

Click the resolution display to access:

![Resolution menu](assets/placeholders/template.svg)
_Placeholder: `interface-resolution-menu.png` — Resolution menu expanded with scale, custom size, aspect ratio, black background, and zoom controls._

- **Scale presets**: 0.25x, 0.5x, 1x, 2x, 4x
- **Custom resolution**: Enter a width and height in pixels or percentages (e.g. `1920` or `50%`)
- **Aspect Ratio**: 16:9, 4:3, 1:1 (square), Fill (full space), Auto (responsive)
- **Save to config**: Pin the resolution to the `.sha.json` config file so it persists
- **Black background**: Force a black canvas background
- **Zoom**: Slider from 0.1x to 3.0x

## Toolbar (Right Side)

| Button | Description |
|--------|-------------|
| <i class="codicon codicon-bug"></i> **Debug** | Enable [debug mode](debugging/index.md) for line-by-line shader debugging |
| <i class="codicon codicon-code"></i> **Editor** | Toggle the [editor overlay](features/editor-overlay.md) for inline code editing |
| <i class="codicon codicon-gear"></i> **Config** | Toggle the config panel for buffer and channel setup |
| <i class="codicon codicon-device-camera"></i> **Record** | Open the [recording panel](features/recording.md) to capture screenshots, video, or GIFs |
| <i class="codicon codicon-lock"></i> **Lock** | Lock the preview to the current shader file so browsing other files doesn't change it |
| <i class="codicon codicon-menu"></i> **Menu** | Open the full options menu |

## Options Menu

Click the **Menu** button (<i class="codicon codicon-menu"></i>) to access all features:

![Options menu expanded](assets/placeholders/template.svg)
_Placeholder: `interface-options-menu.png` — Main options menu expanded with debug, editor, config, recording, shader explorer, snippets, web server, settings, and layout actions._

| Action | Description |
|--------|-------------|
| <i class="codicon codicon-bug"></i> Debug | Toggle debug mode |
| <i class="codicon codicon-code"></i> Editor | Toggle editor overlay |
| <i class="codicon codicon-edit"></i> Vim Mode | Toggle Vim keybindings in the editor overlay |
| <i class="codicon codicon-gear"></i> Config | Toggle config panel |
| <i class="codicon codicon-lock"></i> Lock | Lock to current shader |
| <i class="codicon codicon-device-camera"></i> Export | Open the recording panel |
| <i class="codicon codicon-refresh"></i> Refresh | Force recompile and re-render |
| <i class="codicon codicon-new-file"></i> New Shader | Create a new shader from the default template |
| <i class="codicon codicon-book"></i> Shader Explorer | Browse shaders in your workspace |
| <i class="codicon codicon-library"></i> Snippet Library | Insert GLSL building blocks |
| <i class="codicon codicon-repo-forked"></i> Web Server | Start/stop the HTTP server for browser viewing (shows green dot when running) |
| <i class="codicon codicon-sort-precedence"></i> Settings | Open Shader Studio settings in VS Code |
| <i class="codicon codicon-discard"></i> Reset Layout | Reset docked panels to their default positions |
| **Compile Mode** | Choose between <i class="codicon codicon-flame"></i> **Hot** (compile on every change), <i class="codicon codicon-save"></i> **Save** (compile on file save), or <i class="codicon codicon-clock"></i> **Manual** (compile on demand). See [Compile Modes](features/compile-modes.md). |
| <i class="codicon codicon-unmute"></i> / <i class="codicon codicon-mute"></i> **Audio Volume** | Global volume slider and mute toggle for all audio channel inputs |

## Panel Layout

Shader Studio uses a dockable panel system. Panels (Preview, Debug, Config, Performance) can be rearranged:

- **Drag a tab header** to move a panel to a different group
- **Drag to an edge** (left, right, top, bottom) of an existing group to split it
- **Drag the sash** (the divider between panels) to resize
- **Tab headers** auto-hide when only one panel is in a group; hover near the top edge to reveal them

The layout is saved automatically. Use **Menu → Reset Layout** to return to the default arrangement.

## Next

[Debug A Shader](workflows/debug-shaders.md) — start using the debugging workflow while you edit GLSL.
