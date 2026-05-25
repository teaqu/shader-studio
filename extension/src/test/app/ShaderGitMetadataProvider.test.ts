import * as assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import { ShaderGitMetadataProvider } from '../../app/ShaderGitMetadataProvider';
import type * as vscode from 'vscode';

suite('ShaderGitMetadataProvider Test Suite', () => {
  let sandbox: sinon.SinonSandbox;
  let mockContext: Pick<vscode.ExtensionContext, 'globalStorageUri'>;

  setup(() => {
    sandbox = sinon.createSandbox();
    mockContext = {
      globalStorageUri: { fsPath: '/mock/global/storage' } as any,
    };
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('parseDirtyPaths', () => {
    test('returns empty set for empty output', () => {
      const result = ShaderGitMetadataProvider.parseDirtyPaths('');
      assert.strictEqual(result.size, 0);
    });

    test('ignores untracked files (??)', () => {
      const output = '?? shaders/untracked.glsl\n?? other/new.frag';
      const result = ShaderGitMetadataProvider.parseDirtyPaths(output);
      assert.strictEqual(result.size, 0);
    });

    test('includes working-tree modified files', () => {
      const output = ' M shaders/modified.glsl';
      const result = ShaderGitMetadataProvider.parseDirtyPaths(output);
      assert.ok(result.has('shaders/modified.glsl'));
    });

    test('includes staged files', () => {
      const output = 'M  shaders/staged.frag';
      const result = ShaderGitMetadataProvider.parseDirtyPaths(output);
      assert.ok(result.has('shaders/staged.frag'));
    });

    test('includes staged-and-modified files', () => {
      const output = 'MM shaders/both.vert';
      const result = ShaderGitMetadataProvider.parseDirtyPaths(output);
      assert.ok(result.has('shaders/both.vert'));
    });

    test('includes newly staged files (A)', () => {
      const output = 'A  shaders/added.glsl';
      const result = ShaderGitMetadataProvider.parseDirtyPaths(output);
      assert.ok(result.has('shaders/added.glsl'));
    });

    test('excludes non-shader extensions', () => {
      const output = 'M  shaders/config.json\n M README.md\nA  shaders/script.js';
      const result = ShaderGitMetadataProvider.parseDirtyPaths(output);
      assert.strictEqual(result.size, 0);
    });

    test('handles renamed shader — uses destination path', () => {
      const output = 'R  old/name.glsl -> new/name.glsl';
      const result = ShaderGitMetadataProvider.parseDirtyPaths(output);
      assert.ok(result.has('new/name.glsl'));
      assert.ok(!result.has('old/name.glsl'));
    });

    test('normalizes backslashes to forward slashes', () => {
      const output = ' M shaders\\sub\\file.glsl';
      const result = ShaderGitMetadataProvider.parseDirtyPaths(output);
      assert.ok(result.has('shaders/sub/file.glsl'));
    });

    test('handles mixed dirty and untracked entries', () => {
      const output = [
        ' M shaders/dirty.glsl',
        '?? shaders/untracked.frag',
        'A  shaders/staged.vert',
        'M  README.md',
      ].join('\n');
      const result = ShaderGitMetadataProvider.parseDirtyPaths(output);
      assert.ok(result.has('shaders/dirty.glsl'));
      assert.ok(!result.has('shaders/untracked.frag'));
      assert.ok(result.has('shaders/staged.vert'));
      assert.strictEqual(result.size, 2);
    });
  });

  suite('getMetadataForWorkspace', () => {
    const repoRoot = '/repo';
    const workspaceRoot = '/repo';

    function makeGitRunner(responses: Record<string, string>): sinon.SinonStub {
      return sandbox.stub().callsFake((args: string[]) => {
        const key = args.join(' ');
        for (const [pattern, response] of Object.entries(responses)) {
          if (key.includes(pattern)) {
            return Promise.resolve(response);
          }
        }
        return Promise.reject(new Error(`Unexpected git args: ${key}`));
      });
    }

    test('returns null when git is unavailable', async () => {
      const runGit = sandbox.stub().rejects(new Error('git not found'));
      const provider = new ShaderGitMetadataProvider(mockContext as any, runGit);
      const result = await provider.getMetadataForWorkspace(workspaceRoot, []);
      assert.strictEqual(result, null);
    });

    test('includes dirtyPaths in result', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      sandbox.stub(fs, 'mkdirSync');
      sandbox.stub(fs, 'writeFileSync');

      const runGit = sandbox.stub();
      runGit.withArgs(sinon.match((args: string[]) => args.includes('rev-parse') && args.includes('--show-toplevel')))
        .resolves(`${repoRoot}\n`);
      runGit.withArgs(sinon.match((args: string[]) => args.includes('rev-parse') && args.includes('HEAD')))
        .resolves('abc123\n');
      runGit.withArgs(sinon.match((args: string[]) => args.includes('log') && !args.includes('--diff-filter=A')))
        .resolves('');
      runGit.withArgs(sinon.match((args: string[]) => args.includes('log') && args.includes('--diff-filter=A')))
        .resolves('');
      runGit.withArgs(sinon.match((args: string[]) => args.includes('status') && args.includes('--porcelain')))
        .resolves(' M shaders/dirty.glsl\nA  shaders/staged.frag\n?? shaders/new.vert\n');

      const provider = new ShaderGitMetadataProvider(mockContext as any, runGit);
      const result = await provider.getMetadataForWorkspace(workspaceRoot, []);

      assert.ok(result !== null);
      assert.ok(result!.dirtyPaths.has('shaders/dirty.glsl'));
      assert.ok(result!.dirtyPaths.has('shaders/staged.frag'));
      assert.ok(!result!.dirtyPaths.has('shaders/new.vert'), 'untracked excluded from dirtyPaths');
    });

    test('returns empty dirtyPaths when git status fails', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      sandbox.stub(fs, 'mkdirSync');
      sandbox.stub(fs, 'writeFileSync');

      const runGit = sandbox.stub();
      runGit.withArgs(sinon.match((args: string[]) => args.includes('rev-parse') && args.includes('--show-toplevel')))
        .resolves(`${repoRoot}\n`);
      runGit.withArgs(sinon.match((args: string[]) => args.includes('rev-parse') && args.includes('HEAD')))
        .resolves('abc123\n');
      runGit.withArgs(sinon.match((args: string[]) => args.includes('log') && !args.includes('--diff-filter=A')))
        .resolves('');
      runGit.withArgs(sinon.match((args: string[]) => args.includes('log') && args.includes('--diff-filter=A')))
        .resolves('');
      runGit.withArgs(sinon.match((args: string[]) => args.includes('status')))
        .rejects(new Error('git status failed'));

      const provider = new ShaderGitMetadataProvider(mockContext as any, runGit);
      const result = await provider.getMetadataForWorkspace(workspaceRoot, []);

      assert.ok(result !== null);
      assert.strictEqual(result!.dirtyPaths.size, 0);
    });
  });

  suite('parseGitLog', () => {
    test('extracts modifiedTime from commit log', () => {
      const output = 'commit:1000\nshaders/foo.glsl\n\ncommit:2000\nshaders/bar.frag\n';
      const result = ShaderGitMetadataProvider.parseGitLog(output, 'modified');
      assert.strictEqual(result.get('shaders/foo.glsl')?.modifiedTime, 1_000_000);
      assert.strictEqual(result.get('shaders/bar.frag')?.modifiedTime, 2_000_000);
    });

    test('extracts createdTime from commit log', () => {
      const output = 'commit:500\nshaders/foo.glsl\n';
      const result = ShaderGitMetadataProvider.parseGitLog(output, 'created');
      assert.strictEqual(result.get('shaders/foo.glsl')?.createdTime, 500_000);
    });

    test('modified mode keeps the latest commit time', () => {
      const output = 'commit:3000\nshaders/foo.glsl\n\ncommit:1000\nshaders/foo.glsl\n';
      const result = ShaderGitMetadataProvider.parseGitLog(output, 'modified');
      assert.strictEqual(result.get('shaders/foo.glsl')?.modifiedTime, 3_000_000);
    });

    test('created mode keeps the earliest commit time', () => {
      const output = 'commit:3000\nshaders/foo.glsl\n\ncommit:1000\nshaders/foo.glsl\n';
      const result = ShaderGitMetadataProvider.parseGitLog(output, 'created');
      assert.strictEqual(result.get('shaders/foo.glsl')?.createdTime, 1_000_000);
    });

    test('skips lines before first commit marker', () => {
      const output = 'shaders/orphan.glsl\ncommit:1000\nshaders/foo.glsl\n';
      const result = ShaderGitMetadataProvider.parseGitLog(output, 'modified');
      assert.ok(!result.has('shaders/orphan.glsl'));
      assert.ok(result.has('shaders/foo.glsl'));
    });

    test('normalizes backslashes in paths', () => {
      const output = 'commit:1000\nshaders\\sub\\file.glsl\n';
      const result = ShaderGitMetadataProvider.parseGitLog(output, 'modified');
      assert.ok(result.has('shaders/sub/file.glsl'));
    });
  });
});
