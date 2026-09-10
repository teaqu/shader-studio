import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Phase 14: every docs page listed in the mkdocs Features nav must exist,
// including the WGSL authoring guide.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DOCS_ROOT = path.join(REPO_ROOT, 'docs');

function featuresNavFiles(): string[] {
  const mkdocs = readFileSync(path.join(REPO_ROOT, 'mkdocs.yml'), 'utf8');
  return [...mkdocs.matchAll(/features\/([a-z0-9-]+\.md)/g)].map((m) => m[0]);
}

describe('docs nav consistency', () => {
  it('lists a WGSL authoring guide in the Features nav', () => {
    expect(featuresNavFiles()).toContain('features/wgsl-authoring.md');
  });

  it('every Features nav entry resolves to an existing file', () => {
    const missing = featuresNavFiles().filter(
      (file) => !existsSync(path.join(DOCS_ROOT, file.replace(/^features\//, 'features/'))),
    );
    expect(missing).toEqual([]);
  });

  it('the WGSL guide covers the Slang differences from the spec', () => {
    const guide = path.join(DOCS_ROOT, 'features', 'wgsl-authoring.md');
    const text = readFileSync(guide, 'utf8');
    for (const topic of [
      'mainImage',
      'ptr<function',
      'enable',
      'Sample',
    ]) {
      expect(text).toContain(topic);
    }
  });
});
