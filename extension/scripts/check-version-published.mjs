import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A registry keys a published extension by version, not by commit. Publishing
 * 1.1.0 a second time with `--skip-duplicate` therefore uploads nothing and
 * still reports success: the tag moves, the workflow goes green, and users keep
 * the old build. That is how fixes sat on a tag for hours while the marketplace
 * served a package built before them.
 *
 * This refuses to start a release whose version is already out there. Set
 * ALLOW_EXISTING_VERSION=true to re-run a release deliberately - recovering a
 * half-finished publish, say - and the check reports instead of failing.
 */
const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MARKETPLACE_QUERY_URL =
  'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
export const OPEN_VSX_API = 'https://open-vsx.org/api';

/** @typedef {{ publisher: string, name: string, version: string }} Manifest */

/** @returns {Manifest} */
export function readManifest(root = extensionRoot) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return { publisher: manifest.publisher, name: manifest.name, version: manifest.version };
}

/**
 * Versions the gallery reports for an extension, or [] when it has never been
 * published - the shape is nested deeply enough to be worth its own function.
 * @param {unknown} payload
 * @returns {string[]}
 */
export function marketplaceVersions(payload) {
  const extensions = payload?.results?.[0]?.extensions ?? [];
  const versions = extensions[0]?.versions ?? [];
  return versions.map((entry) => entry?.version).filter((version) => typeof version === 'string');
}

/**
 * @param {Manifest} manifest
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<boolean>}
 */
export async function isOnMarketplace({ publisher, name, version }, fetchImpl = fetch) {
  const response = await fetchImpl(MARKETPLACE_QUERY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json;api-version=3.0-preview.1',
    },
    body: JSON.stringify({
      filters: [{ criteria: [{ filterType: 7, value: `${publisher}.${name}` }] }],
      // IncludeVersions
      flags: 1,
    }),
  });
  if (!response.ok) {
    throw new Error(`marketplace query failed with status ${response.status}`);
  }
  return marketplaceVersions(await response.json()).includes(version);
}

/**
 * @param {Manifest} manifest
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<boolean>}
 */
export async function isOnOpenVsx({ publisher, name, version }, fetchImpl = fetch) {
  const response = await fetchImpl(`${OPEN_VSX_API}/${publisher}/${name}/${version}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`Open VSX query failed with status ${response.status}`);
  }
  return true;
}

const REGISTRIES = {
  marketplace: { label: 'VS Code Marketplace', check: isOnMarketplace },
  'open-vsx': { label: 'Open VSX', check: isOnOpenVsx },
};

/**
 * @param {{ manifest: Manifest, registries?: string[], fetchImpl?: typeof fetch }} options
 * @returns {Promise<string[]>} the registries already serving this version
 */
export async function registriesAlreadyServing({
  manifest,
  registries = Object.keys(REGISTRIES),
  fetchImpl = fetch,
}) {
  const serving = [];
  for (const key of registries) {
    const registry = REGISTRIES[key];
    if (!registry) {
      throw new Error(`unknown registry "${key}"`);
    }
    if (await registry.check(manifest, fetchImpl)) {
      serving.push(registry.label);
    }
  }
  return serving;
}

async function main() {
  const requested = process.argv.slice(2).filter((argument) => !argument.startsWith('-'));
  const manifest = readManifest();
  const allowExisting = process.env.ALLOW_EXISTING_VERSION === 'true';

  let serving;
  try {
    serving = await registriesAlreadyServing({
      manifest,
      ...(requested.length > 0 ? { registries: requested } : {}),
    });
  } catch (error) {
    // Failing closed: an unverifiable registry is not evidence that the version
    // is new, and publishing over it is what this check exists to prevent.
    console.error(`Could not confirm whether ${manifest.version} is already published: ${error.message}`);
    process.exit(allowExisting ? 0 : 1);
  }

  if (serving.length === 0) {
    console.log(`${manifest.publisher}.${manifest.name} ${manifest.version} is not published yet.`);
    return;
  }

  const message = `${manifest.publisher}.${manifest.name} ${manifest.version} is already on ${serving.join(' and ')}.`;
  if (allowExisting) {
    console.log(`${message} Continuing because ALLOW_EXISTING_VERSION is set.`);
    return;
  }

  console.error(`${message}
A registry keys on the version, so publishing it again uploads nothing and
still succeeds - users keep the build they have. Bump the version in
extension/package.json, add its CHANGELOG entry, and tag that instead.
Re-running a half-finished release on purpose? Set ALLOW_EXISTING_VERSION=true.`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  await main();
}
