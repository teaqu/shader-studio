import { describe, expect, it } from 'vitest';
import { resolveSlangWorkspaceFile } from '../lib/slangSourceIdentity';

describe('resolveSlangWorkspaceFile', () => {
  const workspace = {
    rootUri: 'file:///C:/Project',
    files: [
      {
        uri: 'file:///C:/Project/Helper%20File.slang',
        path: '/workspace/Helper File.slang',
        source: 'helper',
      },
    ],
  };

  it.each([
    'C:\\project\\helper file.slang',
    'file:///C:/PROJECT/Helper%20File.slang',
    '/workspace/helper%20file.slang',
  ])('matches Windows paths, URI casing, and escaped spaces: %s', (selector) => {
    expect(resolveSlangWorkspaceFile(workspace, selector)).toEqual({
      status: 'matched',
      file: workspace.files[0],
    });
  });

  it('fails safe when a suffix selector matches more than one file', () => {
    const ambiguous = {
      rootUri: 'file:///project',
      files: [
        { uri: 'file:///project/a/helper.slang', path: '/workspace/a/helper.slang', source: 'a' },
        { uri: 'file:///project/b/helper.slang', path: '/workspace/b/helper.slang', source: 'b' },
      ],
    };

    expect(resolveSlangWorkspaceFile(ambiguous, 'helper.slang')).toEqual({ status: 'ambiguous' });
  });

  it('reports selectors outside the workspace as unmatched', () => {
    expect(resolveSlangWorkspaceFile(workspace, 'C:\\elsewhere\\missing.slang'))
      .toEqual({ status: 'unmatched' });
    expect(resolveSlangWorkspaceFile(workspace, 'D:\\Project\\Helper File.slang'))
      .toEqual({ status: 'unmatched' });
    expect(resolveSlangWorkspaceFile(workspace, '/elsewhere/Helper File.slang'))
      .toEqual({ status: 'unmatched' });
  });
});
