import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Browser tests must compile the workspace source, like the UI build does.
    // Loading core's CommonJS distribution directly leaves its named exports
    // unavailable to browser-native ESM imports from language analysis.
    alias: {
      "@shader-studio/language-server-core": path.resolve(directory, "../language-servers/core/src"),
    },
  },
  test: {
    // GPU timing, backpressure, and pixel readback tests share one device.
    // Concurrent files can starve readbacks and distort measured frame times.
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
          args: ["--enable-unsafe-webgpu"],
        },
      }),
      instances: [{ browser: "chromium" }],
    },
    include: ["src/test/**/*.e2e.test.ts"],
    globals: true,
  },
});
