import path from "node:path";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { loadShaderFixtureCorpus, loadShaderFixtureSources } from "./scripts/shaderFixtureCorpus.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot =
  process.env.SHADER_STUDIO_SHADER_FIXTURES ??
  path.resolve(directory, "../tests/fixtures/shader-corpus");
const projects = loadShaderFixtureCorpus(fixtureRoot);
const wgslSources = loadShaderFixtureSources(fixtureRoot, ".wgsl");
export default defineConfig({
  resolve: {
    // Browser tests must compile the workspace source, like the UI build does.
    // Loading core's CommonJS distribution directly leaves its named exports
    // unavailable to browser-native ESM imports from language analysis.
    alias: {
      "@shader-studio/language-server-core": path.resolve(directory, "../language-servers/core/src"),
    },
  },
  plugins: [
    {
      name: "shader-fixture-corpus",
      resolveId(id) {
        return ["virtual:shader-fixture-corpus", "virtual:wgsl-source-corpus"].includes(id) ? `\0${id}` : undefined;
      },
      load(id) {
        if (id === "\0virtual:shader-fixture-corpus") {
          return `export default ${JSON.stringify(projects)};`;
        }
        return id === "\0virtual:wgsl-source-corpus" ? `export default ${JSON.stringify(wgslSources)};` : undefined;
      },
    },
  ],
  test: {
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { args: ["--enable-unsafe-webgpu"] } }),
      instances: [{ browser: "chromium" }],
    },
    include: ["src/test/e2e/*.corpus.test.ts"],
    globals: true,
  },
});
