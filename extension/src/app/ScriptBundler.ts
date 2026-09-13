import * as fs from "fs";
import * as path from "path";
import type { BuildOptions, Loader, Plugin } from "esbuild-wasm";
import { Logger } from "./services/Logger";

export interface BundleResult {
  success: boolean;
  code?: string;
  error?: string;
}

type EsbuildWasm = typeof import("esbuild-wasm");

/**
 * The engine is WebAssembly rather than esbuild's native binary because the
 * VSIX ships no node_modules, and one universal package cannot carry a 9MB
 * binary per platform - which is why every published release failed to bundle
 * scripts at all. The wasm is a plain asset copied next to the bundle.
 *
 * esbuild-wasm's Node entry point spawns a child process out of its own package
 * directory, which a bundled extension has no copy of, so this uses the
 * in-process browser engine. That engine has no filesystem of its own, so the
 * module graph is served by the plugin below - the same seam a browser host
 * would fill with a virtual workspace.
 */
let engine: Promise<EsbuildWasm> | null = null;

const LOADERS: Record<string, Loader> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
  ".json": "json",
};

/** What esbuild's own resolver would try for an extensionless import. */
const IMPLIED_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx", ".json"];

function loaderFor(filePath: string): Loader {
  return LOADERS[path.extname(filePath).toLowerCase()] ?? "js";
}

function resolveModuleFile(candidate: string): string | null {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }
  for (const extension of IMPLIED_EXTENSIONS) {
    const withExtension = `${candidate}${extension}`;
    if (fs.existsSync(withExtension)) {
      return withExtension;
    }
  }
  for (const extension of IMPLIED_EXTENSIONS) {
    const indexFile = path.join(candidate, `index${extension}`);
    if (fs.existsSync(indexFile)) {
      return indexFile;
    }
  }
  return null;
}

/**
 * Relative imports are read from disk and inlined; bare specifiers stay
 * external so they resolve at runtime from the script's own node_modules,
 * which is what lets a script use npm packages and Node built-ins.
 */
const FILE_NAMESPACE = "shader-studio-script";

function fileSystemPlugin(): Plugin {
  return {
    name: FILE_NAMESPACE,
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!args.path.startsWith(".") && !path.isAbsolute(args.path)) {
          return { external: true };
        }
        const base = args.resolveDir || path.dirname(args.importer);
        const resolved = resolveModuleFile(path.resolve(base, args.path));
        if (!resolved) {
          return { errors: [{ text: `Could not resolve "${args.path}"` }] };
        }
        return { path: resolved, namespace: FILE_NAMESPACE };
      });

      build.onLoad({ filter: /.*/, namespace: FILE_NAMESPACE }, (args) => ({
        contents: fs.readFileSync(args.path, "utf8"),
        loader: loaderFor(args.path),
        resolveDir: path.dirname(args.path),
      }));
    },
  };
}

/** Candidate locations, in the order the layouts they belong to appear. */
function locateWasmBinary(): string {
  const candidates = [
    // Packaged: dist/extension.js with the binary copied beside it.
    path.join(__dirname, "esbuild.wasm"),
    // Compiled tests: out/app/ScriptBundler.js, with dist built alongside.
    path.resolve(__dirname, "..", "..", "dist", "esbuild.wasm"),
  ];

  try {
    candidates.push(path.join(
      path.dirname(require.resolve("esbuild-wasm/package.json")),
      "esbuild.wasm",
    ));
  } catch {
    // Not resolvable as a package; the copied asset is the real path anyway.
  }

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`esbuild.wasm not found beside the extension (looked in ${candidates.join(", ")})`);
  }
  return found;
}

/**
 * esbuild-wasm refuses a second initialize() in the same process, so startup is
 * memoised - including a failure, which would otherwise be retried on every
 * keystroke in a script file.
 */
async function loadEngine(): Promise<EsbuildWasm> {
  if (!engine) {
    engine = (async () => {
      // The browser build is CJS behind a wrapper, so Node's ESM interop can
      // only see a default export; a bundled CJS require sees the namespace.
      const loaded = await import("esbuild-wasm/lib/browser.js") as any;
      const esbuild = (typeof loaded?.initialize === "function"
        ? loaded
        : loaded?.default) as EsbuildWasm;
      const wasmModule = await WebAssembly.compile(fs.readFileSync(locateWasmBinary()));

      // Starting the wasm without a worker reaches for `self`, which Node does
      // not have. Builds after startup never touch it, so the global is put
      // back rather than left standing: libraries sharing this extension host
      // read `self` to decide they are in a browser.
      const globals = globalThis as unknown as { self?: unknown };
      const hadSelf = "self" in globals;
      const previousSelf = globals.self;
      globals.self ??= globalThis;
      try {
        await esbuild.initialize({ wasmModule, worker: false });
      } finally {
        if (hadSelf) {
          globals.self = previousSelf;
        } else {
          delete globals.self;
        }
      }
      return esbuild;
    })();
  }
  return engine;
}

export class ScriptBundler {
  private logger = Logger.getInstance();

  public async bundle(scriptPath: string, content?: string): Promise<BundleResult> {
    try {
      const esbuild = await loadEngine();
      const source = content ?? fs.readFileSync(scriptPath, "utf8");
      const buildOptions: BuildOptions = {
        bundle: true,
        format: "iife",
        globalName: "__shaderUniforms",
        write: false,
        platform: "node",
        target: "es2020",
        packages: "external",
        plugins: [fileSystemPlugin()],
        stdin: {
          contents: source,
          resolveDir: path.dirname(scriptPath),
          sourcefile: path.basename(scriptPath),
          loader: loaderFor(scriptPath),
        },
      };

      const result = await esbuild.build(buildOptions);

      if (result.errors.length > 0) {
        const errorMsg = result.errors.map(e => e.text).join("\n");
        return { success: false, error: errorMsg };
      }

      const code = result.outputFiles?.[0]?.text;
      if (!code) {
        return { success: false, error: "No output from esbuild" };
      }

      return { success: true, code };
    } catch (err: any) {
      const message = err?.message || String(err);
      this.logger.warn(`Script bundle failed: ${message}`);
      return { success: false, error: message };
    }
  }
}
