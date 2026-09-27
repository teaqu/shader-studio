# Mobile Device Acceptance

Use a production build through Tailscale Serve for private, trusted HTTPS without exposing the preview publicly. On the Mac, start the preview from the `mobile` branch:

```sh
npm run preview:mobile
```

The existing private Tailscale route forwards HTTPS port 9443 to the preview server. If it needs to be recreated, run:

```sh
tailscale serve --https=9443 --bg 4173
```

Open `https://calums-mac-mini.tail182f21.ts.net:9443/` on a phone or tablet connected to the same tailnet. Stop the preview with Ctrl-C; remove only this route with `tailscale serve --https=9443 off`.

Confirm the build identifier in the header before recording results. The preview uses its own HTTPS origin, service-worker caches, local storage, and IndexedDB; it cannot replace production app data.

Record the device model, OS version, browser version, installed/Home Screen mode, build identifier, and result for every run. HTTPS is required for installation and reliable service-worker testing; LAN HTTP is not equivalent.

## iPhone and iPad

- Safari tab and Home Screen launch
- 320–430 CSS px portrait and landscape
- safe areas in every orientation
- editor typing, selection handles, copy/paste, composition, and keyboard open/close
- Explorer search/create/select, Preview, dedicated Editor, and editor overlay
- Config, Debug touch pixel selection, Frame Times, and an available Export mode
- background/resume, reload, and workspace persistence
- export backup, replace-confirmed import, and save-failure/session-only messages
- online launch, Prepare Offline Compilers, terminate, reopen offline, edit, render, save, and reload
- build A to build B update with an unsaved edit queued before accepting

## Android

Repeat the matrix in Chrome and in the installed app. Include touch drag/cancel, browser download behavior, storage persistence status, and WebGL/WebGPU capability messages.

## Desktop Regression

Run the complete standalone Playwright suite, standalone and UI unit suites, full UI check, ESLint, and relevant rendering tests. Verify desktop Dockview layout persistence before and after crossing the phone breakpoint. Shared UI changes also require the relevant extension and Electron checks.

## Capability Limits

GLSL remains the baseline offline path where WebGL is available. Slang and WGSL require both prepared compiler assets and device WebGPU support. Shader Studio reports those limits; an install alone does not imply WebGPU support or durable user storage.
