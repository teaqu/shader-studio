import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
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
