import { afterEach, describe, expect, it } from 'vitest';
import { getSlangAssetUrls } from './slangAssets';

const metaNames = {
  script: 'shader-studio-slang-script-url',
  wasm: 'shader-studio-slang-wasm-url',
  worker: 'shader-studio-slang-worker-url',
} as const;

function addMeta(name: string, content: string) {
  const meta = document.createElement('meta');
  meta.name = name;
  meta.content = content;
  document.head.append(meta);
}

function addValidMetadata(overrides: Partial<Record<keyof typeof metaNames, string | null>> = {}) {
  const values: Record<keyof typeof metaNames, string | null> = {
    script: 'vscode-webview://shader-studio/assets/slang.js',
    wasm: 'vscode-webview://shader-studio/assets/slang.wasm',
    worker: 'vscode-webview://shader-studio/assets/slang-worker.js',
    ...overrides,
  };

  for (const label of Object.keys(metaNames) as Array<keyof typeof metaNames>) {
    const value = values[label];
    if (value !== null) {
      addMeta(metaNames[label], value);
    }
  }
}

describe('getSlangAssetUrls', () => {
  afterEach(() => {
    document.head.replaceChildren();
  });

  it('returns the canonical injected asset URLs with debug timings enabled', () => {
    addValidMetadata();

    expect(getSlangAssetUrls()).toEqual({
      scriptUrl: 'vscode-webview://shader-studio/assets/slang.js',
      wasmUrl: 'vscode-webview://shader-studio/assets/slang.wasm',
      workerUrl: 'vscode-webview://shader-studio/assets/slang-worker.js',
      debugTimings: true,
    });
  });

  it.each([
    ['script', null, 'script'],
    ['script', '', 'script'],
    ['script', ' \n\t ', 'script'],
    ['wasm', null, 'wasm'],
    ['wasm', '', 'wasm'],
    ['wasm', ' \n\t ', 'wasm'],
    ['worker', null, 'worker'],
    ['worker', '', 'worker'],
    ['worker', ' \n\t ', 'worker'],
  ] as const)('throws when %s metadata contains %j', (label, content, expectedLabel) => {
    addValidMetadata({ [label]: content });

    expect(() => getSlangAssetUrls()).toThrow(`Missing Slang asset metadata for ${expectedLabel}`);
  });

  it('returns HTML-decoded metadata content', () => {
    document.head.innerHTML = `
      <meta name="${metaNames.script}" content="vscode-webview://shader/slang.js?x=1&amp;y=2">
      <meta name="${metaNames.wasm}" content="vscode-webview://shader/slang.wasm?x=1&amp;y=2">
      <meta name="${metaNames.worker}" content="vscode-webview://shader/worker.js?x=1&amp;y=2">
    `;

    expect(getSlangAssetUrls()).toMatchObject({
      scriptUrl: 'vscode-webview://shader/slang.js?x=1&y=2',
      wasmUrl: 'vscode-webview://shader/slang.wasm?x=1&y=2',
      workerUrl: 'vscode-webview://shader/worker.js?x=1&y=2',
    });
  });

  it('trims whitespace around injected URLs', () => {
    addValidMetadata({
      script: '  vscode-webview://shader/slang.js  ',
      wasm: '\tvscode-webview://shader/slang.wasm\n',
      worker: '\n vscode-webview://shader/worker.js\t',
    });

    expect(getSlangAssetUrls()).toMatchObject({
      scriptUrl: 'vscode-webview://shader/slang.js',
      wasmUrl: 'vscode-webview://shader/slang.wasm',
      workerUrl: 'vscode-webview://shader/worker.js',
    });
  });

  it('uses only exact canonical meta names when alternate selectors are present', () => {
    addMeta('slang-script-url', 'alternate-script.js');
    addMeta(`${metaNames.script}-backup`, 'backup-script.js');
    addMeta('slang-wasm-url', 'alternate.wasm');
    addMeta(`${metaNames.wasm}-backup`, 'backup.wasm');
    addMeta('slang-worker-url', 'alternate-worker.js');
    addMeta(`${metaNames.worker}-backup`, 'backup-worker.js');
    addValidMetadata();

    expect(getSlangAssetUrls()).toMatchObject({
      scriptUrl: 'vscode-webview://shader-studio/assets/slang.js',
      wasmUrl: 'vscode-webview://shader-studio/assets/slang.wasm',
      workerUrl: 'vscode-webview://shader-studio/assets/slang-worker.js',
    });
  });
});
