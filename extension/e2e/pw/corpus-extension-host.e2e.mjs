import { test, expect, workspacePath } from './fixtures.mjs';
import { loadShaderFixtureCorpus } from '../../../rendering/scripts/shaderFixtureCorpus.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test.use({ vscodeKey: 'corpus-extension-host' });

const here = dirname(fileURLToPath(import.meta.url));
const corpusRoot = resolve(here, '..', '..', '..', 'tests', 'fixtures', 'shader-corpus');

/**
 * Capabilities the standalone host does not implement, mirrored from
 * `unsupportedByStandaloneHost` in `ui/src/test/e2e/CorpusViaTransport.e2e.test.ts`.
 * This rig covers exactly those projects through the real extension host; keep
 * the two predicates in sync, and shrink the UI one as capabilities move over.
 */
function standaloneGap(project) {
  if (project.config?.script) {
    return 'standalone host has no script evaluator for custom uniforms';
  }
  const passes = Object.values(project.config?.passes ?? {});
  if (passes.some((pass) => pass && 'geometry' in pass && pass.geometry?.type === 'model')) {
    return 'standalone host does not resolve model geometry assets';
  }
  if (passes.some((pass) => pass?.path?.startsWith('@/') || pass?.vertex?.startsWith('@/'))) {
    return 'standalone host does not resolve @/ source paths';
  }
  // The raw workspace file, not the loader's copy: the loader inlines Slang
  // dependencies, so its sources no longer show the imports the host resolves.
  const rawSource = readFileSync(join(corpusRoot, project.name), 'utf8');
  if (project.language === 'slang' && /^\s*(?:__exported\s+)?(?:import|__include|#include)\s/m.test(rawSource)) {
    return 'standalone host does not inline Slang imports/includes';
  }
  return null;
}

/** Channel counts above the portable floor fail on conformant devices. */
function mayExceedPortableImageLimit(project) {
  const imageInputs = Object.keys(project.config?.passes?.Image?.inputs ?? {}).length;
  return project.language === 'glsl' ? imageInputs > 12 : imageInputs > 16;
}

const projects = loadShaderFixtureCorpus(corpusRoot).filter((project) => standaloneGap(project) !== null);

// A fast-failing sentinel: every project verdict is read off the pause-button
// error state, which a previous project may have left behind. Forcing a known
// error first makes each verdict fresh — absence afterwards means this project
// compiled, and any error text provably belongs to it.
const SENTINEL_TOKEN = 'SENTINEL_BROKEN_XYZ';
const SENTINEL_SOURCE = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(${SENTINEL_TOKEN}, 1.0);
}
`;

let sentinelPath = '';

test.beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), 'ss-corpus-sentinel-'));
  sentinelPath = join(directory, 'sentinel.glsl');
  writeFileSync(sentinelPath, SENTINEL_SOURCE, 'utf8');
});

test.afterAll(() => {
  rmSync(dirname(sentinelPath), { recursive: true, force: true });
});

test('opens the corpus as the workspace folder', async ({ vscode }) => {
  // `@/` source paths resolve against the workspace folder, and the launched
  // window carries none (workspaceFolders is empty), so `@/` projects would
  // silently resolve against the shader directory instead. Registering the
  // folder explicitly is what makes `@/` coverage real.
  await vscode.evaluateInHost(async (vscode, root) => {
    vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.file(root) });
  }, corpusRoot);
  await expect.poll(() => vscode.evaluateInHost(async (vscode, p) => {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(p));
    return folder ? folder.uri.fsPath : null;
  }, join(corpusRoot, 'glsl/foundation/debugging/passes/history_glsl.glsl')), {
    timeout: 30_000, message: 'corpus folder never appeared in the workspace',
  }).toBe(corpusRoot);
});

test('runs with the corpus as its workspace', () => {
  // `@/` source paths resolve against the workspace folder; any other
  // workspace silently mis-resolves them instead of failing.
  expect(
    workspacePath,
    'run via npm run test:e2e:vscode:corpus so SHADER_STUDIO_E2E_WORKSPACE points at the corpus',
  ).toBe(corpusRoot);
});

test('covers every standalone gap project', () => {
  expect(projects.length).toBeGreaterThan(0);
});

// Closing first keeps a single preview panel alive: every view command spawns
// a panel, and stale panels keep capture loops running against the shared GPU.
async function openShader(vscode, targetPath) {
  await vscode.evaluateInHost(async (vscode, path) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false,
    });
    await vscode.commands.executeCommand('shader-studio.view');
  }, targetPath);
}

const pauseErrorClass = (frame) => frame.evaluate(
  () => document.querySelector('button[aria-label="Toggle pause"]')?.className ?? '',
);
const errorTooltipText = (frame) => frame.evaluate(
  () => document.querySelector('.error-tooltip')?.textContent ?? '',
);

for (const project of projects) {
  test(`extension host compiles ${project.name}`, async ({ vscode }) => {
    // The frame is re-resolved on every read: panels come and go as shaders
    // open, and a captured handle dies with its webview.
    const liveText = (read) => async () => read(await vscode.shaderFrame(10_000));

    await openShader(vscode, sentinelPath);
    await expect.poll(liveText(errorTooltipText), {
      timeout: 60_000, message: 'sentinel shader never reported its error',
    }).toContain(SENTINEL_TOKEN);

    await openShader(vscode, join(corpusRoot, project.name));
    // Settles on the first compilation result for this project: either the
    // error state clears, or the tooltip stops describing the sentinel.
    // Hanging here means the project never produced a result at all.
    await expect.poll(async () => {
      const frame = await vscode.shaderFrame(10_000);
      if (!(await pauseErrorClass(frame)).includes('error')) {
        return 'settled-clean';
      }
      return (await errorTooltipText(frame)).includes(SENTINEL_TOKEN) ? 'stale' : 'settled-error';
    }, {
      timeout: 90_000, message: `${project.name} never produced a compilation result`,
    }).not.toBe('stale');

    const frame = await vscode.shaderFrame(10_000);
    if (!(await pauseErrorClass(frame)).includes('error')) {
      return;
    }
    const tooltip = await errorTooltipText(frame);
    // Mirrors the UI rig: channel counts above the portable floor fail on
    // conformant devices, which is a limit verdict, not a regression.
    if (mayExceedPortableImageLimit(project)
      && /MAX_TEXTURE_IMAGE_UNITS|samplers|number of sampled textures/.test(tooltip)) {
      return;
    }
    throw new Error(`${project.name} failed to compile in the extension host:\n${tooltip}`);
  });
}
