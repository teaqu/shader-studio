// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('../App.svelte', import.meta.url), 'utf8');

describe('standalone mobile preview toolbar styles', () => {
  it('hides duplicate tool launchers only below the mobile breakpoint', () => {
    expect(component).toMatch(/@media \(max-width: 767px\)[\s\S]*?:global\(\.standalone-app \.menu-bar \.collapse-config, \.standalone-app \.menu-bar \.collapse-debug, \.standalone-app \.menu-bar \.collapse-record\)\s*{\s*display: none/);
  });
});
