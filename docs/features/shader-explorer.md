# Shader Explorer


Shader Explorer lets you browse, search, and preview all shader files in your workspace.

## Opening

- Toolbar menu → **Shader Explorer**
- Command palette → **Shader Studio: Open Shader Explorer**

![Shader explorer panel](../assets/placeholders/template.svg)
_Placeholder: `feature-shader-explorer.png` — Shader explorer panel showing a grid of shader cards with thumbnails, search bar, and sort controls._

## Search and Sort

- **Search** — type in the search bar to filter shaders by name or path (case-insensitive)
- **Sort by** — dropdown with options:
    - **Name** — alphabetical A–Z
    - **Updated** — most recently modified first
    - **Created** — newest first
- **Sort order** — toggle button to switch ascending/descending

## Display Options

- **Card size** — slider (200–1000px width) to control how large shader cards appear
- **Page size** — dropdown to show 10, 20, 30, 50, or 100 shaders per page
- **Hide failed** — checkbox to hide shaders that failed to compile

## Shader Cards

Each shader appears as a card in a responsive grid layout:

- **Thumbnail** — 16:9 aspect ratio live render of the shader
- **Name** — filename without the `.glsl` extension
- **Path** — relative directory path within the workspace
- **Config button** — open existing `.sha.json` config, or generate a new one
- **Click** — opens the shader in a new preview panel

![Shader card close-up](../assets/placeholders/template.svg)
_Placeholder: `feature-shader-card.png` — Close-up of a single shader card showing the thumbnail, name, path, and config button._

## Pagination

When there are more shaders than the page size, pagination controls appear at the bottom:

- **Previous / Next** buttons
- **Page numbers** for direct navigation
- Ellipsis (`...`) when there are many pages

## Refresh

Click the **refresh button** to re-scan the workspace for shaders and regenerate thumbnails. There is a short rendering delay (~3 seconds) while thumbnails are captured.

## State Persistence

The explorer remembers your sort order, page size, card size, and hide-failed preference across sessions.
