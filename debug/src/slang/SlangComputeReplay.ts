import type { SlangWorkspace, SlangWorkspaceFile } from './SlangWorkspace';
import type { SlangToken } from './tokens';

const BARRIERS = new Set([
  'AllMemoryBarrier', 'AllMemoryBarrierWithGroupSync', 'DeviceMemoryBarrier',
  'DeviceMemoryBarrierWithGroupSync', 'GroupMemoryBarrier', 'GroupMemoryBarrierWithGroupSync',
]);
const SUBGROUP_OPERATIONS = new Set([
  'WaveActiveAllEqual', 'WaveActiveAllTrue', 'WaveActiveAnyTrue', 'WaveActiveBallot',
  'WaveActiveBitAnd', 'WaveActiveBitOr', 'WaveActiveBitXor', 'WaveActiveCountBits',
  'WaveActiveMax', 'WaveActiveMin', 'WaveActiveProduct', 'WaveActiveSum',
  'WaveGetLaneCount', 'WaveGetLaneIndex', 'WaveIsFirstLane', 'WaveMatch',
  'WaveMultiPrefixBitAnd', 'WaveMultiPrefixBitOr', 'WaveMultiPrefixBitXor',
  'WaveMultiPrefixCountBits', 'WaveMultiPrefixProduct', 'WaveMultiPrefixSum',
  'WavePrefixCountBits', 'WavePrefixProduct', 'WavePrefixSum',
  'WaveReadLaneAt', 'WaveReadLaneFirst', 'QuadReadAcrossDiagonal', 'QuadReadAcrossX',
  'QuadReadAcrossY', 'QuadReadLaneAt', 'QuadAll', 'QuadAny',
]);
const MUTATIONS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '++', '--']);
const ATOMIC_MUTATIONS = new Set(['add', 'sub', 'and', 'or', 'xor', 'min', 'max', 'exchange', 'compareExchange', 'store']);

/** Both Slang debug modes run a fragment replay, with read-only storage bindings. */
export function slangComputeReplayLimitation(workspace: SlangWorkspace): string | undefined {
  const storage = new Set(workspace.compute?.storageNames ?? []);
  for (const file of workspace.filesByUri.values()) {
    const tokens = replayTokens(file);
    if (tokens.some(token => token.kind === 'identifier' && token.text === 'groupshared')) {
      return 'Slang compute replay does not support workgroup memory (including workgroup atomics).';
    }
    if (tokens.some(token => token.kind === 'identifier' && BARRIERS.has(token.text))) {
      return 'Slang compute replay does not support barriers.';
    }
    if (tokens.some(token => token.kind === 'identifier' && SUBGROUP_OPERATIONS.has(token.text))) {
      return 'Slang compute replay does not support subgroup operations.';
    }
    if (writesStorage(tokens, storage, file)) {
      return 'Slang compute replay does not support writes to configured storage.';
    }
  }
  return undefined;
}

function writesStorage(tokens: readonly SlangToken[], names: ReadonlySet<string>, file: SlangWorkspaceFile): boolean {
  return tokens.some((token, index) => {
    if (token.kind !== 'identifier' || !names.has(token.text) || tokens[index - 1]?.text === '.' || isLocal(file, token)) {
      return false;
    }
    if (['&', '++', '--'].includes(tokens[index - 1]?.text ?? '')) {
      return true;
    }
    let cursor = index + 1;
    while (cursor < tokens.length) {
      if (tokens[cursor]?.text === '[') {
        let depth = 0;
        do {
          const text = tokens[cursor++]?.text;
          if (text === '[') {
            depth++;
          }
          if (text === ']') {
            depth--;
          }
        } while (cursor < tokens.length && depth > 0);
      } else if (tokens[cursor]?.text === '.' && tokens[cursor + 1]?.kind === 'identifier') {
        if (ATOMIC_MUTATIONS.has(tokens[cursor + 1].text) && tokens[cursor + 2]?.text === '(') {
          return true;
        }
        cursor += 2;
      } else {
        break;
      }
    }
    return MUTATIONS.has(tokens[cursor]?.text ?? '');
  });
}

function replayTokens(file: SlangWorkspaceFile): SlangToken[] {
  const tokens = [...file.preprocessor.activeTokens];
  const expanded = new Set<string>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const macro = file.preprocessor.macros.get(token.text);
    if (token.kind === 'identifier' && macro && !expanded.has(token.text)) {
      expanded.add(token.text);
      tokens.push(...macro.bodyTokens);
    }
  }
  return tokens.filter(token => token.kind !== 'comment' && token.kind !== 'whitespace');
}

function isLocal(file: SlangWorkspaceFile, token: SlangToken): boolean {
  const before = (a: { line: number; character: number }, b: { line: number; character: number }) =>
    a.line < b.line || (a.line === b.line && a.character <= b.character);
  return [...file.structure.declarations.values()].some(declaration => {
    if (declaration.name !== token.text || !before(declaration.range.start, token.range.start)) {
      return false;
    }
    const scope = file.structure.scopes.get(declaration.scopeId);
    return scope !== undefined && scope.kind !== 'module'
      && before(scope.range.start, token.range.start) && before(token.range.end, scope.range.end);
  });
}
