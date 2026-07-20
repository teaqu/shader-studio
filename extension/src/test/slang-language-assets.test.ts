import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { Worker } from "worker_threads";
import type {
  SlangWorkerRequest,
  SlangWorkerResponse,
} from "@shader-studio/slang-language-service";

function workerRequest(
  worker: Worker,
  request: SlangWorkerRequest,
  timeoutMilliseconds = 10_000,
): Promise<SlangWorkerResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for packaged Slang worker request ${request.id}`));
    }, timeoutMilliseconds);
    const onMessage = (response: SlangWorkerResponse): void => {
      if (response.id !== request.id) {
        return;
      }
      cleanup();
      resolve(response);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number): void => {
      cleanup();
      reject(new Error(`Packaged Slang worker exited with code ${code}`));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
    worker.postMessage(request);
  });
}

suite("Slang language assets", () => {
  const extensionRoot = path.resolve(__dirname, "..", "..");

  test("declares a dedicated Slang language, grammar, and configuration", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
    const language = manifest.contributes.languages.find((entry: { id: string }) => entry.id === "slang");
    const grammar = manifest.contributes.grammars.find((entry: { language: string }) => entry.language === "slang");

    assert.deepStrictEqual(language.extensions, [".slang"]);
    assert.strictEqual(language.configuration, "./slang-language-configuration.json");
    assert.deepStrictEqual(grammar, {
      language: "slang",
      scopeName: "source.slang",
      path: "./syntaxes/slang.tmLanguage.json",
    });
  });

  test("ships Slang-specific lexical and editing configuration", () => {
    const grammar = JSON.parse(fs.readFileSync(path.join(extensionRoot, "syntaxes/slang.tmLanguage.json"), "utf8"));
    const configuration = JSON.parse(fs.readFileSync(path.join(extensionRoot, "slang-language-configuration.json"), "utf8"));
    const serialized = JSON.stringify(grammar);

    assert.strictEqual(grammar.scopeName, "source.slang");
    for (const token of [
      "module", "import", "implementing", "__include", "interface", "__generic",
      "shader", "float4", "Texture", "meta.preprocessor", "comment", "string", "numeric",
    ]) {
      assert.ok(serialized.includes(token), `grammar should cover ${token}`);
    }
    assert.deepStrictEqual(configuration.comments, { lineComment: "//", blockComment: ["/*", "*/"] });
    assert.ok(Array.isArray(configuration.brackets));
    assert.ok(Array.isArray(configuration.autoClosingPairs));
    assert.ok(typeof configuration.wordPattern === "string");
  });

  test("declares the language server toggle", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
    assert.deepStrictEqual(manifest.contributes.configuration.properties["shader-studio.slangLanguageFeatures"], {
      type: "boolean",
      default: true,
      description: "Enable Slang hover, completion, navigation, symbols, signature help, and diagnostics.",
    });
  });

  test("build places the worker and pinned Slang runtime at deterministic paths", () => {
    for (const asset of ["slangLanguageWorker.js", "slang-wasm.mjs", "slang-wasm.wasm"]) {
      const assetPath = path.join(extensionRoot, "dist", "slang", asset);
      assert.ok(fs.statSync(assetPath).size > 0, `${asset} should be packaged`);
    }
  });

  test("packaged worker loads the copied Slang runtime and serves RPC", async function () {
    this.timeout(20_000);
    const worker = new Worker(path.join(extensionRoot, "dist", "slang", "slangLanguageWorker.js"));
    const uri = "file:///workspace/main.slang";
    const source = "#language slang 2026\nmodule main;\nfloat4 mainImage(float2 p) { return 0; }\n";
    try {
      const initialized = await workerRequest(worker, {
        id: 1,
        method: "init",
        snapshot: {
          rootUri: "file:///workspace",
          files: [{ uri, path: "main.slang", source, version: 1 }],
        },
      });
      assert.deepStrictEqual(initialized, { id: 1, ok: true, result: true });

      const replaced = await workerRequest(worker, {
        id: 2,
        method: "replaceFiles",
        snapshot: {
          rootUri: "file:///workspace",
          files: [
            { uri, path: "main.slang", source, version: 1 },
            {
              uri: "file:///workspace/helper.slang",
              path: "helper.slang",
              source: "#language slang 2026\nmodule helper;\n",
            },
          ],
        },
      });
      assert.deepStrictEqual(replaced, { id: 2, ok: true, result: true });

      const opened = await workerRequest(worker, {
        id: 3,
        method: "openDocument",
        document: { uri, path: "main.slang", source, version: 1 },
      });
      assert.deepStrictEqual(opened, { id: 3, ok: true, result: true });

      const diagnostics = await workerRequest(worker, {
        id: 4,
        method: "diagnostics",
        uri,
        documentVersion: 1,
      });
      assert.strictEqual(diagnostics.ok, true);
      if (diagnostics.ok) {
        assert.ok(Array.isArray(diagnostics.result));
        assert.strictEqual(diagnostics.documentVersion, 1);
      }
    } finally {
      await worker.terminate();
    }
  });
});
