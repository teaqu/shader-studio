import path from "node:path";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { loadShaderFixtureCorpus } from "./scripts/shaderFixtureCorpus.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = process.env.SHADER_STUDIO_SHADER_FIXTURES
  ?? path.resolve(directory, "src/test/fixtures/shader-corpus");
const projects = loadShaderFixtureCorpus(fixtureRoot);

export default defineConfig({
  plugins: [{
    name: "shader-fixture-corpus",
    resolveId(id) {
      return id === "virtual:shader-fixture-corpus" ? `\0${id}` : undefined;
    },
    load(id) {
      return id === "\0virtual:shader-fixture-corpus"
        ? `export default ${JSON.stringify(projects)};`
        : undefined;
    },
  }],
  test: {
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { args: ["--enable-unsafe-webgpu"] } }),
      instances: [{ browser: "chromium" }],
    },
    include: ["src/test/e2e/ShaderFixtureCorpus.corpus.test.ts"],
    globals: true,
  },
});
