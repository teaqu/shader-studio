# Performance Monitor


The frame times panel shows a real-time graph of your shader's rendering performance.

## Opening

Click the **FPS** display in the toolbar and enable **Frame Times**.

![Frame times panel](../assets/placeholders/template.svg)
_Placeholder: `feature-frame-times.png` — Frame times graph showing a scrollable canvas with reference lines at 16.6ms and 33.3ms, and a hover tooltip._

## Reading the Graph

The graph plots frame time (in milliseconds) on the Y-axis over recent history on the X-axis.

**Reference lines:**

| Line | Value | Meaning |
|------|-------|---------|
| Green | 16.6ms | 60 fps |
| Yellow | 33.3ms | 30 fps |
| Blue | Auto-detected | Your screen refresh rate |

A dashed line shows the **rolling average** frame time.

Switch to **FPS mode** to display frames-per-second on the Y-axis instead of milliseconds.

## Controls

### Zoom and Pan

| Action | Effect |
|--------|--------|
| Scroll horizontally | Pan through history |
| Ctrl + scroll | Zoom Y-axis (1x–32x) |
| Click zoom buttons | Cycle Y-axis zoom |
| Drag | Pan the visible window |
| **Center** button | Re-center the visible area on the rolling average |

### Time Window

Click the time window buttons to change how many samples are shown:

- Narrow (≈0.5s) — detailed view of recent frames
- Medium (≈5s) — default
- Wide (≈60s) — long-term trend

### Downsample

For large history buffers, use the downsample control to reduce the number of rendered points (1:1, 1:2, 1:4, 1:8). This keeps the graph fast when zoomed out.

### Pause

Click **Pause** to freeze the graph. Useful for inspecting a specific spike. Click again to resume.

## Tips

- A spike above the 16.6ms line means a frame was rendered slower than 60 fps
- Consistent high values suggest the shader is GPU-bound; try lowering the resolution scale
- Zoom in vertically (Ctrl+scroll up) to magnify small variations
- Pan left to examine earlier history
