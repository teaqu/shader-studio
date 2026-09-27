import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = readFileSync(new URL('./playwright.config.mjs', import.meta.url), 'utf8');
const namedChannels = readFileSync(new URL('./named-channels.e2e.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../.github/workflows/verify.yml', import.meta.url), 'utf8');
const vitestConfig = readFileSync(new URL('../vitest.config.ts', import.meta.url), 'utf8');

test('standalone servers and asset URLs use the configured endpoints', () => {
  assert.match(config, /baseURL: productionOrigin/);
  assert.match(config, /baseURL: developmentOrigin/);
  assert.match(config, /port: productionPort/);
  assert.match(config, /port: developmentPort/);
  assert.match(namedChannels, /productionOrigin/);
  assert.doesNotMatch(namedChannels, /127\.0\.0\.1:4174/);
});

test('public CI assigns isolated standalone ports before browser tests', () => {
  assert.match(workflow, /name: Configure isolated standalone E2E ports/);
  assert.match(workflow, /GITHUB_RUN_ID/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/);
  assert.match(workflow, /STANDALONE_E2E_PORT=.*GITHUB_ENV/);
  assert.match(workflow, /STANDALONE_E2E_DEV_PORT=.*GITHUB_ENV/);
  assert.ok(workflow.indexOf('Configure isolated standalone E2E ports') < workflow.indexOf('Run all standalone browser projects'));
});

test('Node helper tests stay outside the jsdom Vitest project', () => {
  assert.match(vitestConfig, /\*\*\/e2e\/\*\*\/\*\.test\.mjs/);
});
