# Recording


Shader Studio can capture your shader output as a screenshot, video, or animated GIF.

## Opening the Recording Panel

Click the <i class="codicon codicon-device-camera"></i> **Record** button in the toolbar, or open **Menu → Export**.

![Recording panel](../assets/placeholders/template.svg)
_Placeholder: `feature-recording-panel.png` — Recording panel open with screenshot, video, and GIF export options visible._

## Screenshot

Capture a single frame as a PNG or JPEG.

| Option | Description |
|--------|-------------|
| **Format** | PNG or JPEG |
| **JPEG quality** | 0–100 (JPEG only). Higher = better quality, larger file. |
| **Time** | Shader time at which to capture. Defaults to current time. |
| **Resolution** | 480p, 720p, 1080p, 4K, or custom pixel dimensions |

Click **Capture** to save. A live canvas preview updates as you change options.

## Video

Record shader output as an MP4 (H.264) or WebM (VP8) file using the browser's WebCodecs API.

| Option | Description |
|--------|-------------|
| **Format** | MP4 or WebM |
| **Start time** | Shader time to begin recording from |
| **Duration** | Presets: 2π (≈6.3s), 5s, 10s, 30s, 60s, or custom |
| **FPS** | 24, 30, 60, or custom |
| **Resolution** | 480p, 720p, 1080p, 4K, or custom |

Click **Record** to start. A progress bar shows rendering and finalization phases. Click **Cancel** to abort.

**Notes:**
- MP4 requires H.264 encoding support in the browser (available in most modern browsers)
- Resolution is rounded to even pixel dimensions for MP4 codec compatibility
- Default bitrate is 5 Mbps

## GIF

Record an animated GIF using the gifski encoder (WASM).

| Option | Description |
|--------|-------------|
| **Start time** | Shader time to begin from |
| **Duration** | Presets or custom |
| **FPS** | 10, 15, 24, 30, or custom |
| **Colors** | Palette size: 32, 64, 128, 256 |
| **Loop** | Infinite or play once |
| **Quality** | 1–100 (higher = better quality, larger file) |

An estimated file size is shown before recording. Click **Record** to start.

**Tips:**
- Lower FPS and color counts produce smaller GIF files
- Quality 80–90 gives a good balance of size and visual quality
- GIF encoding runs in a background worker and does not block the UI

## During Recording

- A live canvas preview is shown in the panel
- A progress bar tracks both the render phase and the encoding/finalization phase
- Click **Cancel** at any time to stop and discard the recording
