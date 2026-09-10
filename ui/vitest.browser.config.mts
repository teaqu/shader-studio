import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { loadShaderFixtureCorpus } from "../rendering/scripts/shaderFixtureCorpus.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot =
  process.env.SHADER_STUDIO_SHADER_FIXTURES ??
  path.resolve(directory, "../tests/fixtures/shader-corpus");
const projects = loadShaderFixtureCorpus(fixtureRoot);

// Raw corpus text files, so the standalone host performs every bit of project
// derivation itself (config discovery, pass sources, vertex sources, path
// maps) instead of the test re-deriving it.
const CORPUS_TEXT_EXTENSIONS = new Set([".glsl", ".slang", ".wgsl", ".json", ".ts"]);

function collectCorpusFiles(directory: string, root: string, out: { path: string; contents: string }[] = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git") {
      continue;
    }
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectCorpusFiles(absolute, root, out);
    } else if (CORPUS_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push({
        path: `/${path.relative(root, absolute).split(path.sep).join("/")}`,
        contents: fs.readFileSync(absolute, "utf8"),
      });
    }
  }
  return out;
}

const corpusFiles = collectCorpusFiles(fixtureRoot, fixtureRoot);

// Drives the real UI pipeline (ShaderPipeline -> ShaderProcessor) against the
// real rendering engine, so arrangement decisions the corpus render sweep
// bypasses are compiled on an actual device.
export default defineConfig({
  plugins: [
    svelte({ hot: false }),
    {
      name: "shader-fixture-corpus",
      resolveId(id) {
        return id === "virtual:shader-fixture-corpus" || id === "virtual:shader-corpus-files"
          ? `\0${id}`
          : undefined;
      },
      load(id) {
        return id === "\0virtual:shader-fixture-corpus"
          ? `export default ${JSON.stringify(projects)};`
          : id === "\0virtual:shader-corpus-files"
            ? `export default ${JSON.stringify(corpusFiles)};`
            : undefined;
      },
    },
  ],
  resolve: {
    alias: [
      // Browser tests must compile the workspace source, like the UI build does;
      // core's CommonJS distribution leaves named exports unavailable to ESM.
      { find: "@shader-studio/language-server-core", replacement: path.resolve(directory, "../language-servers/core/src") },
      { find: "@shader-studio/glsl-analysis", replacement: path.resolve(directory, "../language-servers/glsl-analysis/src") },
      { find: "@shader-studio/wgsl-analysis", replacement: path.resolve(directory, "../language-servers/wgsl-analysis/src") },
      { find: "@shader-studio/debug", replacement: path.resolve(directory, "../debug/src") },
      { find: "@shader-studio/monaco", replacement: path.resolve(directory, "../monaco/src") },
      { find: "@shader-studio/rendering", replacement: path.resolve(directory, "../rendering/src") },
      { find: "@shader-studio/types", replacement: path.resolve(directory, "../types/src") },
    ],
  },
  test: {
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { args: ["--enable-unsafe-webgpu"] } }),
      instances: [{ browser: "chromium" }],
    },
    include: ["src/test/e2e/**/*.e2e.test.ts"],
    globals: true,
  },
});
