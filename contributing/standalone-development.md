# Standalone Development

## Run Locally

From the repository root, install dependencies and start the standalone app:

```bash
npm install
npm run dev:standalone
```

Open the local URL printed by Vite. This opens your local standalone workspace.

To build and preview the static app:

```bash
npm run build:standalone
npm run preview -w @shader-studio/standalone
```

The build output is in `standalone/dist/`. Serve it over HTTP locally or HTTPS when hosting it; opening the HTML file directly is not the supported workflow.

Run the phone and offline browser regressions with:

```bash
npm run test:e2e -w @shader-studio/standalone -- --project=mobile-chromium
npm run test:e2e -w @shader-studio/standalone -- --project=chromium pwa.e2e.mjs
```

Browser emulation does not validate installation, software-keyboard behavior, selection handles, safe areas, background eviction, or GPU capability on a real phone. Follow the [mobile device acceptance checklist](mobile-testing.md) before releasing mobile changes.

