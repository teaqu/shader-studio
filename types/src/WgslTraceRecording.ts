import type { WgslTraceRecording } from './WgslTrace';

type RecordData = Record<string, unknown>;
const MAX_VALUE_DEPTH = 16;
const MAX_VALUES_PER_LIST = 1024;
const MAX_FRAMES_PER_EVENT = 256;

/** Validate the serialized GPU recording before feeding it to a debug adapter. */
export function validateWgslTraceRecording(value: unknown): asserts value is WgslTraceRecording {
  const record = object(value);
  validateHeader(record);
  const sources = collectSources(record);
  const sites = collectSites(record, sources);
  validateEvents(record, sites);
}

function validateHeader(record: RecordData): void {
  const valid = typeof record.path === 'string' && record.path.endsWith('.wgsl')
    && typeof record.source === 'string'
    && typeof record.overflow === 'boolean'
    && Array.isArray(record.color)
    && record.color.length === 4
    && record.color.every(component => typeof component === 'number' && Number.isFinite(component));
  if (!valid) {
    throw new Error('Invalid WGSL project recording.');
  }
}

function collectSources(record: RecordData): Map<string, string> {
  const sources = new Map<string, string>([[record.path as string, record.source as string]]);
  if (record.sources === undefined) {
    return sources;
  }
  if (!Array.isArray(record.sources)) {
    throw new Error('Invalid WGSL recording source list.');
  }
  for (const item of record.sources) {
    const source = object(item);
    if (!validSource(source)) {
      throw new Error('Invalid WGSL recording source.');
    }
    if (sources.has(source.path) && sources.get(source.path) !== source.source) {
      throw new Error('Conflicting WGSL recording source snapshots.');
    }
    sources.set(source.path, source.source);
  }
  return sources;
}

function validSource(source: RecordData): source is RecordData & { path: string; source: string } {
  return typeof source.path === 'string' && source.path.endsWith('.wgsl') && typeof source.source === 'string';
}

function collectSites(record: RecordData, sources: ReadonlyMap<string, string>): Map<number, RecordData> {
  if (!Array.isArray(record.sites) || !Array.isArray(record.events) || record.events.length > 16_384) {
    throw new Error('Invalid WGSL recording events.');
  }
  const sites = new Map<number, RecordData>();
  for (const item of record.sites) {
    const site = object(item);
    if (!validSite(site, sources) || sites.has(site.id)) {
      throw new Error('Invalid WGSL trace source site.');
    }
    sites.set(site.id, site);
  }
  return sites;
}

function validSite(site: RecordData, sources: ReadonlyMap<string, string>): site is RecordData & { id: number } {
  const validPath = site.path === undefined || (typeof site.path === 'string' && sources.has(site.path));
  return integer(site.id, 0) && integer(site.line, 1) && integer(site.column, 1)
    && Array.isArray(site.variables) && validPath;
}

function validateEvents(record: RecordData, sites: ReadonlyMap<number, RecordData>): void {
  for (const item of record.events as unknown[]) {
    const event = object(item);
    const site = sites.get(event.siteId as number);
    if (!sameSourceLocation(event, site) || !Array.isArray(event.values)) {
      throw new Error('Invalid WGSL trace event source location.');
    }
    validateValues(event.values, 0);
    validateFrames(event, sites);
  }
}

function sameSourceLocation(event: RecordData, site: RecordData | undefined): boolean {
  return site !== undefined && event.line === site.line && event.column === site.column
    && event.path === site.path && event.functionName === site.functionName;
}

function validateFrames(event: RecordData, sites: ReadonlyMap<number, RecordData>): void {
  if (event.frames === undefined) {
    return;
  }
  if (!Array.isArray(event.frames) || event.frames.length > MAX_FRAMES_PER_EVENT) {
    throw new Error('Invalid WGSL trace event frames.');
  }
  const ids = new Set<number>();
  for (const item of event.frames) {
    const frame = object(item);
    if (!integer(frame.id, 0) || typeof frame.functionName !== 'string' || !Array.isArray(frame.values)
      || ids.has(frame.id) || !hasSiteLocation(frame, sites)) {
      throw new Error('Invalid WGSL trace event frame.');
    }
    ids.add(frame.id);
    validateValues(frame.values, 0);
  }
}

function hasSiteLocation(frame: RecordData, sites: ReadonlyMap<number, RecordData>): boolean {
  return [...sites.values()].some(site => sameSourceLocation(frame, site));
}

function validateValues(values: unknown[], depth: number): void {
  if (depth > MAX_VALUE_DEPTH || values.length > MAX_VALUES_PER_LIST) {
    throw new Error('Invalid WGSL recorded local tree.');
  }
  for (const item of values) {
    const local = object(item);
    if (typeof local.name !== 'string' || typeof local.type !== 'string' || !validValue(local.value)
      || (local.children !== undefined && !Array.isArray(local.children))) {
      throw new Error('Invalid WGSL recorded local.');
    }
    if (local.children !== undefined) {
      validateValues(local.children, depth + 1);
    }
  }
}

function object(value: unknown): RecordData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid WGSL recording data.');
  }
  return value as RecordData;
}

function integer(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
}

function validValue(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value))
    || (Array.isArray(value) && value.length <= MAX_VALUES_PER_LIST && value.every(component => typeof component === 'boolean' || typeof component === 'string'
      || (typeof component === 'number' && Number.isFinite(component))));
}
