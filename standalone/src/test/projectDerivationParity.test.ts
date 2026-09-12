import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  configPathForShader,
  resolveConfiguredPath,
  shaderLanguageForPath,
  stageForPass,
  vertexPassKey,
  type ConfiguredPathHost,
  type ShaderConfig,
} from '@shader-studio/types';
import { collectSlangDependencies, resolveSlangIncludes } from '@shader-studio/utils';
import { loadShaderFixtureCorpus } from '../../../rendering/scripts/shaderFixtureCorpus.mjs';
import {
  ShaderAuthoringEnvironmentProvider,
} from '../../../extension/src/language-services/ShaderAuthoringEnvironmentProvider';
import { WebExtensionHost } from '../WebExtensionHost';
import { MemoryWorkspaceStore, VirtualWorkspace } from '../VirtualWorkspace';
import { setWorkspaceRoot } from './vscodeStub';

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS_ROOT = resolve(here, '../../../tests/fixtures/shader-corpus');

// The fixtures stand in for an opened workspace: `@/` resolves against the
// corpus root on every subsystem, so root-relative paths are comparable.
// `vscode` resolves to ./vscodeStub.ts via the vitest config alias.
setWorkspaceRoot(CORPUS_ROOT);

const nodeHost: ConfiguredPathHost = {
  workspaceRootFor: () => CORPUS_ROOT,
  joinPath: (...segments) => join(...segments),
  dirnameOf: (value) => dirname(value),
  normalizePath: (value) => normalize(value),
  isAbsolutePath: (value) => isAbsolute(value),
};

const readDisk = (abs: string): string | null => {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
};

interface ExpectedSource {
  /** Owning pass, or the vertex-sentinel key for companions, or 'common'. */
  key: string;
  abs: string;
  rel: string;
  vertexOf: string | null;
}

function expectedSources(configPath: string, config: ShaderConfig): ExpectedSource[] {
  const out: ExpectedSource[] = [];
  for (const [passName, pass] of Object.entries(config.passes ?? {})) {
    if (!pass) {
      continue;
    }
    if ('path' in pass && typeof pass.path === 'string' && pass.path) {
      const abs = resolveConfiguredPath(nodeHost, configPath, pass.path);
      out.push({ key: passName, abs, rel: relative(CORPUS_ROOT, abs).split(sep).join('/'), vertexOf: null });
    }
    if ('vertex' in pass && typeof pass.vertex === 'string' && pass.vertex) {
      const abs = resolveConfiguredPath(nodeHost, configPath, pass.vertex);
      out.push({ key: vertexPassKey(passName), abs, rel: relative(CORPUS_ROOT, abs).split(sep).join('/'), vertexOf: passName });
    }
  }
  return out;
}

function stageOf(config: ShaderConfig, source: ExpectedSource): string {
  if (source.vertexOf) {
    return 'vertex';
  }
  const passName = source.key === 'common' ? 'common' : source.key;
  return stageForPass(config, passName, source.abs);
}

describe('project derivation parity', () => {
  const corpus = loadShaderFixtureCorpus(CORPUS_ROOT);
  const provider = new ShaderAuthoringEnvironmentProvider();

  it('loads the corpus every subsystem derives from', () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  it('derives identical file identity, stage, buffer membership and dependencies', async () => {
    const failures: string[] = [];
    const check = (ok: boolean, message: string) => {
      if (!ok) {
        failures.push(message);
      }
    };

    for (const project of corpus) {
      const configPath = configPathForShader(project.path);
      const config = project.config as ShaderConfig;
      const seen = new Set<string>();
      const allSources = expectedSources(configPath, config)
        .filter((source) => readDisk(source.abs) !== null)
        .filter((source) => shaderLanguageForPath(source.abs) !== null);
      const expected = allSources
        // A source owned elsewhere (an on-disk sibling config claims it) is
        // covered under its own project: the companion rule associates it
        // there on every subsystem (e.g. timing's BufferB lives in b.slang,
        // owned by b.sha.json).
        .filter((source) => {
          const companion = configPathForShader(source.abs);
          return !existsSync(companion) || companion === configPath;
        })
        // A file shared by several passes of one config keeps the first
        // owner in config order, matching findExplicitPass first-match.
        .filter((source) => {
          if (seen.has(source.abs)) {
            return false;
          }
          seen.add(source.abs);
          return true;
        });
      const language = shaderLanguageForPath(project.path);
      if (!language) {
        continue;
      }

      // Standalone derivation over a virtual workspace mirroring the
      // project's on-disk layout, so `/`-rooted virtual paths line up with
      // corpus-root-relative paths.
      const files = [{ path: `/${relative(CORPUS_ROOT, configPath).split(sep).join('/')}`, contents: readFileSync(configPath, 'utf8'), createdAt: 1, modifiedAt: 1 }];
      for (const source of expected) {
        files.push({ path: `/${source.rel}`, contents: readDisk(source.abs) as string, createdAt: 1, modifiedAt: 1 });
      }
      const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), files);
      const host = new WebExtensionHost(workspace);
      const documents = host.getWorkspaceDocuments(language);
      const docByRel = new Map(documents.map((doc) => [new URL(doc.uri).pathname.slice(1), doc]));

      // Buffer membership: corpus keys are pass names (vertex companions use
      // the sentinel); Image appears only when explicitly pathed. Membership
      // covers every referenced file, including ones owned elsewhere.
      const expectedKeys = new Set(allSources.map((source) => source.key));
      check(
        JSON.stringify([...Object.keys(project.buffers ?? {}).sort()]) === JSON.stringify([...expectedKeys].sort()),
        `${project.name}: corpus buffers ${JSON.stringify(Object.keys(project.buffers ?? {}).sort())} != expected ${JSON.stringify([...expectedKeys].sort())}`,
      );

      for (const source of expected) {
        const doc = {
          uri: {
            scheme: 'file',
            fsPath: source.abs,
            toString: () => `file://${source.abs}`,
          },
          languageId: language,
          getText: () => readDisk(source.abs) as string,
        };
        // AuthoringDocument shape is a vscode type; the stubbed host only
        // reads uri/languageId/getText, so a structural cast is sufficient.
        const env = provider.environmentFor(doc as never);
        const standaloneDoc = docByRel.get(source.rel);

        // File identity: every subsystem associates the source with the project.
        check(env !== undefined, `${project.name}: extension has no environment for ${source.rel}`);
        check(standaloneDoc !== undefined, `${project.name}: standalone has no document for ${source.rel}`);

        // The extension associates via companion/loaded/upward search, the
        // standalone host via the sibling config only (item 5 discovery gap):
        // assert pass and stage only where each subsystem associated the file.
        const siblingConfig = configPathForShader(source.abs) === configPath;
        const configDir = configPath.slice(0, configPath.lastIndexOf('/'));
        const extAssociated = source.abs === configPath || source.abs.startsWith(`${configDir}/`);
        if (env && extAssociated) {
          check(env.passName === (source.vertexOf ?? source.key),
            `${project.name}: extension pass ${env.passName} != ${source.vertexOf ?? source.key} for ${source.rel}`);
        }
        if (env) {
          check(env.stage === stageOf(config, source),
            `${project.name}: extension stage ${env.stage} != ${stageOf(config, source)} for ${source.rel}`);
        }
        if (standaloneDoc && siblingConfig) {
          check(standaloneDoc.stage === stageOf(config, source),
            `${project.name}: standalone stage ${standaloneDoc.stage} != ${stageOf(config, source)} for ${source.rel}`);
        }
        if (env && standaloneDoc && siblingConfig) {
          check(env.stage === standaloneDoc.stage,
            `${project.name}: stage disagreement for ${source.rel}: extension ${env.stage} vs standalone ${standaloneDoc.stage}`);
        }

        // Common: sibling-anchored commons resolve everywhere; `@/` commons
        // only where the subsystem's discovery reaches (item 5, out of scope).
        const commonRef = (config.passes as Record<string, { path?: unknown }>)?.common?.path;
        const commonAnchored = typeof commonRef === 'string' && !commonRef.startsWith('@/');
        if (source.key !== 'common' && commonAnchored) {
          const commonAbs = resolveConfiguredPath(nodeHost, configPath, commonRef as string);
          const extCommon = env?.commonFile
            ? (env.commonFile.uri as string).replace(/^file:\/\//, '')
            : undefined;
          const standaloneCommon = standaloneDoc?.commonUri
            ? new URL(standaloneDoc.commonUri as string).pathname
            : undefined;
          check(extCommon === commonAbs,
            `${project.name}: extension common ${extCommon} != ${commonAbs} (from ${source.rel})`);
          // The standalone host only associates files with a sibling config
          // (item 5 discovery gap): buffers in subdirectories keep no common.
          if (siblingConfig) {
            check(standaloneCommon === commonAbs,
              `${project.name}: standalone common ${standaloneCommon} != ${commonAbs} (from ${source.rel})`);
          }
        }
      }

      // Corpus common text is the on-disk common source, verbatim.
      const commonSource = expected.find((source) => source.key === 'common');
      if (commonSource) {
        check((project.buffers as Record<string, string>)?.common === readDisk(commonSource.abs),
          `${project.name}: corpus common text differs from ${commonSource.rel}`);
      }

      // Dependencies (slang only: the corpus inlines no other language): every
      // module the extension resolves for a source is inlined in the corpus
      // output for that source's pass.
      for (const source of expected) {
        if (shaderLanguageForPath(source.abs) !== 'slang') {
          continue;
        }
        const text = readDisk(source.abs) as string;
        const modules = collectSlangDependencies({
          rootPath: source.abs, rootSource: text, ownerPass: source.key, readSource: readDisk,
        }).modules;
        const includes = resolveSlangIncludes(text, source.abs, readDisk).includedPaths;
        const output = source.vertexOf !== null
          ? (project.buffers as Record<string, string>)?.[vertexPassKey(source.vertexOf)]
          : source.key === 'Image' && !(project.buffers as Record<string, string>)?.Image
            ? (project as unknown as { image: string }).image
            : (project.buffers as Record<string, string>)?.[source.key];
        for (const dep of [...modules.map((m) => m.source), ...includes.map((p) => readDisk(p) as string)]) {
          const snippet = dep
            .replace(/^[ \t]*module\s+[A-Za-z_]\w*\s*;[ \t]*[\r\n]*/m, '')
            .replace(/^[ \t]*implementing\s+[A-Za-z_]\w*\s*;[ \t]*[\r\n]*/m, '')
            .trim()
            .slice(0, 200);
          if (!snippet) {
            continue;
          }
          check(typeof output === 'string' && output.includes(snippet),
            `${project.name}: corpus output for ${source.key} is missing inlined dependency ${source.rel}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
