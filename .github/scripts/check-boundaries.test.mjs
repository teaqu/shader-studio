import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { checkBoundaries } from "./check-boundaries.mjs";

function fixture(packages) {
  const root = mkdtempSync(join(tmpdir(), "shader-studio-boundaries-"));
  mkdirSync(join(root, "language-servers"));
  for (const [directory, manifest, source] of packages) {
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, directory, "package.json"), JSON.stringify(manifest));
    if (typeof source === "string") {
      writeFileSync(join(root, directory, "index.ts"), source);
    } else {
      for (const [path, text] of Object.entries(source)) {
        const target = join(root, directory, path);
        mkdirSync(join(target, ".."), { recursive: true });
        writeFileSync(target, text);
      }
    }
  }
  return root;
}

test("boundary check catches undeclared, forbidden, deep, and runtime-cycle imports", () => {
  const root = fixture([
    ["types", { name: "@shader-studio/types" }, 'import "@shader-studio/rendering";'],
    ["rendering", { name: "@shader-studio/rendering", dependencies: { "@shader-studio/types": "*" } }, 'import "@shader-studio/types/private";'],
    ["utils", { name: "@shader-studio/utils" }, 'import "@shader-studio/types";'],
    ["extension", { name: "shader-studio", dependencies: { "shader-studio-ui": "*" } }, 'import "shader-studio-ui";'],
    ["ui", { name: "shader-studio-ui", dependencies: { "shader-studio": "*" } }, 'import("shader-studio");'],
    ["standalone", { name: "@shader-studio/standalone" }, ""],
    ["debug", { name: "@shader-studio/debug" }, ""],
    ["shader-explorer", { name: "shader-explorer-ui" }, ""],
    ["monaco", { name: "@shader-studio/monaco" }, ""],
    ["language-servers/core", { name: "@shader-studio/language-server-core" }, ""],
  ]);
  try {
    const errors = checkBoundaries(root).join("\n");
    assert.match(errors, /types.*may not import @shader-studio\/rendering/);
    assert.match(errors, /@shader-studio\/types\/private; use/);
    assert.match(errors, /utils.*imports undeclared workspace dependency @shader-studio\/types/);
    assert.match(errors, /shader-studio may not import shader-studio-ui/);
    assert.match(errors, /runtime workspace dependency cycle: shader-studio -> shader-studio-ui -> shader-studio/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("type-only imports do not make runtime cycles", () => {
  const root = fixture([
    ["types", { name: "@shader-studio/types" }, ""],
    ["utils", { name: "@shader-studio/utils" }, ""],
    ["rendering", { name: "@shader-studio/rendering", dependencies: { "@shader-studio/debug": "*" } }, 'import type { Debug } from "@shader-studio/debug";'],
    ["debug", { name: "@shader-studio/debug", dependencies: { "@shader-studio/rendering": "*" } }, 'import type { Rendering } from "@shader-studio/rendering";'],
    ["extension", { name: "shader-studio" }, ""],
    ["ui", { name: "shader-studio-ui" }, ""],
    ["standalone", { name: "@shader-studio/standalone" }, ""],
    ["shader-explorer", { name: "shader-explorer-ui" }, ""],
    ["monaco", { name: "@shader-studio/monaco" }, ""],
    ["language-servers/core", { name: "@shader-studio/language-server-core" }, ""],
  ]);
  try {
    assert.deepEqual(checkBoundaries(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("boundary check resolves local modules, relative package bypasses, query imports, and worker URL imports", () => {
  const root = fixture([
    ["types", { name: "@shader-studio/types" }, {
      "index.ts": 'import "./first";',
      "first.ts": 'import "./second";',
      "second.ts": 'import "./first";',
    }],
    ["utils", { name: "@shader-studio/utils" }, 'import "../types/index"; import "../types/index?worker&url";'],
    ["ui", { name: "shader-studio-ui" }, 'new Worker(new URL("@shader-studio/glsl-language-server/private", import.meta.url));'],
    ["rendering", { name: "@shader-studio/rendering" }, ""],
    ["extension", { name: "shader-studio" }, ""],
    ["standalone", { name: "@shader-studio/standalone" }, ""],
    ["debug", { name: "@shader-studio/debug" }, ""],
    ["shader-explorer", { name: "shader-explorer-ui" }, ""],
    ["monaco", { name: "@shader-studio/monaco" }, ""],
    ["language-servers/core", { name: "@shader-studio/language-server-core" }, ""],
    ["language-servers/glsl", { name: "@shader-studio/glsl-language-server" }, ""],
  ]);
  try {
    const errors = checkBoundaries(root).join("\n");
    assert.match(errors, /relative import \.\.\/types\/index crosses into @shader-studio\/types/);
    assert.match(errors, /relative import \.\.\/types\/index\?worker&url crosses into @shader-studio\/types/);
    assert.match(errors, /runtime module cycle: types\/first\.ts -> types\/second\.ts -> types\/first\.ts/);
    assert.match(errors, /@shader-studio\/glsl-language-server\/private; use/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("boundary check treats literal CommonJS requires as runtime workspace imports", () => {
  const root = fixture([
    ["types", { name: "@shader-studio/types" }, 'require("@shader-studio/rendering");'],
    ["rendering", { name: "@shader-studio/rendering" }, ""],
    ["utils", { name: "@shader-studio/utils" }, 'require("@shader-studio/types");'],
    ["extension", { name: "shader-studio" }, ""],
    ["ui", { name: "shader-studio-ui" }, ""],
    ["standalone", { name: "@shader-studio/standalone" }, ""],
    ["debug", { name: "@shader-studio/debug" }, ""],
    ["shader-explorer", { name: "shader-explorer-ui" }, ""],
    ["monaco", { name: "@shader-studio/monaco" }, ""],
    ["language-servers/core", { name: "@shader-studio/language-server-core" }, ""],
  ]);
  try {
    const errors = checkBoundaries(root).join("\n");
    assert.match(errors, /types.*imports undeclared workspace dependency @shader-studio\/rendering/);
    assert.match(errors, /types.*may not import @shader-studio\/rendering/);
    assert.match(errors, /utils.*imports undeclared workspace dependency @shader-studio\/types/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("foundation manifests cannot declare higher-layer workspace dependencies", () => {
  const root = fixture([
    ["types", { name: "@shader-studio/types", dependencies: { "@shader-studio/rendering": "*" } }, ""],
    ["utils", { name: "@shader-studio/utils", dependencies: { "@shader-studio/types": "*" } }, ""],
    ["rendering", { name: "@shader-studio/rendering" }, ""],
    ["extension", { name: "shader-studio" }, ""],
    ["ui", { name: "shader-studio-ui" }, ""],
    ["standalone", { name: "@shader-studio/standalone" }, ""],
    ["debug", { name: "@shader-studio/debug" }, ""],
    ["shader-explorer", { name: "shader-explorer-ui" }, ""],
    ["monaco", { name: "@shader-studio/monaco" }, ""],
    ["language-servers/core", { name: "@shader-studio/language-server-core" }, ""],
  ]);
  try {
    const errors = checkBoundaries(root).join("\n");
    assert.match(errors, /@shader-studio\/types may not declare workspace dependency @shader-studio\/rendering/);
    assert.doesNotMatch(errors, /@shader-studio\/utils may not declare/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("type-only local imports do not make module cycles", () => {
  const root = fixture([
    ["types", { name: "@shader-studio/types" }, {
      "index.ts": 'import type { Second } from "./second"; export type First = Second;',
      "second.ts": 'import type { First } from "./index"; export type Second = First;',
    }],
    ["utils", { name: "@shader-studio/utils" }, ""],
    ["rendering", { name: "@shader-studio/rendering" }, ""],
    ["extension", { name: "shader-studio" }, ""],
    ["ui", { name: "shader-studio-ui" }, ""],
    ["standalone", { name: "@shader-studio/standalone" }, ""],
    ["debug", { name: "@shader-studio/debug" }, ""],
    ["shader-explorer", { name: "shader-explorer-ui" }, ""],
    ["monaco", { name: "@shader-studio/monaco" }, ""],
    ["language-servers/core", { name: "@shader-studio/language-server-core" }, ""],
  ]);
  try {
    assert.deepEqual(checkBoundaries(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
