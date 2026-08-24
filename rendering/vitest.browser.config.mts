import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

const chromiumArgs =
  process.env.SHADER_STUDIO_SOFTWARE_WEBGPU === "1"
    ? [
        "--enable-unsafe-webgpu",
        "--ignore-gpu-blocklist",
        "--enable-gpu",
        "--enable-features=Vulkan",
        "--use-angle=swiftshader",
        "--use-vulkan=swiftshader",
        "--enable-unsafe-swiftshader",
      ]
    : ["--enable-unsafe-webgpu"];

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
          args: chromiumArgs,
        },
      }),
      instances: [{ browser: "chromium" }],
    },
    include: ["src/test/**/*.e2e.test.ts"],
    globals: true,
  },
});
