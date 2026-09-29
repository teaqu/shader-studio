# Recording

Shader Studio can capture your shader output as a screenshot, video, or animated GIF.

## Opening the Recording Panel

Click the <i class="codicon codicon-device-camera"></i> **Record** button in the toolbar, or open **Menu → Export**.

## Screenshot

Capture a single frame as a PNG or JPEG. **Live** captures the pixels currently
shown in the preview without changing shader time or resolution. **Render**
creates a separate capture at a selected time and resolution.

| Option | Description |
|--------|-------------|
| **Format** | PNG or JPEG |
| **Mode** | Live preview pixels, or a separate Render capture |
| **Capture frame at** | Shader time for Render mode: `0` or a time you enter. Preceding frames are rendered first. |
| **Resolution** | Current, 720p, 1080p, 4K, or custom dimensions in Render mode |

Click **Capture screenshot** to save. Render mode simulates every preceding
frame before the requested frame, so feedback buffers and `iFrame` match a
continuous run rather than jumping directly to the selected time.

![Screenshot options](../assets/images/recording-screenshot.png)

## Video

Record shader output as an MP4 (H.264) or WebM file. **Live** records the
existing preview until you choose **Stop & save**; it does not restart the
shader or create another rendering engine. **Render** produces a deterministic
clip at a chosen time, duration, and resolution.

| Option | Description |
|--------|-------------|
| **Format** | MP4 or WebM |
| **Mode** | Live preview recording, or a separate Render recording |
| **Start time** | Shader time to begin from in Render mode |
| **Duration** | Render presets: 2π (≈6.3s), 5s, 10s, 30s, 60s, or custom |
| **FPS** | 24, 30, 60, or custom |
| **Resolution** | Current, 720p, 1080p, 4K, or custom in Render mode |

Video bitrate is selected automatically from the output resolution, frame rate,
and codec. Render mode shows separate preparation, rendering, encoding, and
saving phases. Click **Cancel** to abort a Render recording. During a Live
recording, choose **Discard** or **Stop & save**. Editing the shader keeps
recording the same canvas; opening a different shader or changing the preview's
pixel resolution stops a Live recording because its output size or source is no
longer stable.

![Video options](../assets/images/recording-video.png)

## GIF

Record an animated GIF.

| Option | Description |
|--------|-------------|
| **Start time** | Shader time to begin from |
| **Duration** | Presets or custom |
| **FPS** | 10, 15, 24, 30, or custom |
| **Loop** | Infinite or play once |
| **Quality** | 1–100 (higher = better quality, larger file) |

An estimated file size is shown before recording. Captures that would require
an unsafe amount of raw frame memory are rejected with guidance to reduce the
duration, FPS, or resolution. Click **Record** to start.

![GIF options](../assets/images/recording-gif.png)

**Tips:**
- For shaders you usually want **Quality 100** to preserve fine detail, but try reducing it if the file is too large
- Lower FPS and resolution also produce smaller GIF files

## Capture state and settings

Render captures freeze the shader source, pass configuration, buffers, language
modules, source paths, and current custom-uniform values when capture begins.
Later editor or script updates do not change a capture already in progress.

Each output remembers its own settings across reloads. Encoding, browser
capability, memory, and save failures are shown in the Recording panel. Saving
remains visible until the host confirms completion.

## Next

[Open in Browser](web-server.md) — preview your shader in a web browser
