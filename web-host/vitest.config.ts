import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    name: "web-host",
    environment: "jsdom",
    globals: true,
  },
  resolve: {
    alias: {
      "@shader-studio/types": path.resolve(__dirname, "../types/src"),
    },
  },
});
