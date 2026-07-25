import { describe, expect, it } from 'vitest';
import {
  cloneSlangWorkspace,
  resolveSlangWorkspaceFile,
} from '../lib/slangSourceIdentity';
import type { SlangWorkspaceSnapshot } from '@shader-studio/types';

const workspace = (files: SlangWorkspaceSnapshot['files'] = [{
  uri: 'file:///project/image.slang',
  path: '/workspace/image.slang',
  source: 'original',
  version: 1,
}]): SlangWorkspaceSnapshot => ({ rootUri: 'file:///project', files });

describe('slangSourceIdentity', () => {
  it('deep-clones a workspace before runtime retention', () => {
    const original = workspace();
    const clone = cloneSlangWorkspace(original);

    clone.files[0].source = 'changed';
    clone.files[0].version = 2;

    expect(original.files[0]).toEqual({
      uri: 'file:///project/image.slang',
      path: '/workspace/image.slang',
      source: 'original',
      version: 1,
    });
  });

  it('matches an exact URI before a relative suffix', () => {
    const source = workspace([
      { uri: 'file:///project/a/common.slang', path: '/workspace/a/common.slang', source: 'a' },
      { uri: 'file:///project/b/common.slang', path: '/workspace/b/common.slang', source: 'b' },
    ]);

    expect(resolveSlangWorkspaceFile(source, 'file:///project/b/common.slang')).toEqual({
      status: 'matched', file: source.files[1],
    });
  });

  it('matches an exact internal path', () => {
    const source = workspace();

    expect(resolveSlangWorkspaceFile(source, '/workspace/image.slang')).toEqual({
      status: 'matched', file: source.files[0],
    });
  });

  it('refuses an ambiguous relative selector', () => {
    const result = resolveSlangWorkspaceFile(workspace([
      { uri: 'file:///project/a/common.slang', path: '/workspace/a/common.slang', source: 'a' },
      { uri: 'file:///project/b/common.slang', path: '/workspace/b/common.slang', source: 'b' },
    ]), 'common.slang');

    expect(result).toEqual({ status: 'ambiguous' });
  });

  it('reports an unmatched selector', () => {
    expect(resolveSlangWorkspaceFile(workspace(), 'missing.slang')).toEqual({ status: 'unmatched' });
  });
});
