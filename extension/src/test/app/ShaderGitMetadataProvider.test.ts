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

  suite('parseDeletedShadersByBasename', () => {
    test('returns empty map for empty output', () => {
      const result = ShaderGitMetadataProvider.parseDeletedShadersByBasename('');
      assert.strictEqual(result.size, 0);
    });

    test('detects working-tree deleted shader', () => {
      const output = ' D src/draw/circle.glsl\n';
      const result = ShaderGitMetadataProvider.parseDeletedShadersByBasename(output);
      assert.strictEqual(result.get('circle.glsl'), 'src/draw/circle.glsl');
    });

    test('detects staged deleted shader', () => {
      const output = 'D  src/draw/circle.glsl\n';
      const result = ShaderGitMetadataProvider.parseDeletedShadersByBasename(output);
      assert.strictEqual(result.get('circle.glsl'), 'src/draw/circle.glsl');
    });

    test('ignores untracked files', () => {
      const output = '?? src/2024/circle.glsl\n';
      const result = ShaderGitMetadataProvider.parseDeletedShadersByBasename(output);
      assert.strictEqual(result.size, 0);
    });

    test('ignores non-shader files', () => {
      const output = ' D src/config.json\n D src/shader.md\n';
      const result = ShaderGitMetadataProvider.parseDeletedShadersByBasename(output);
      assert.strictEqual(result.size, 0);
    });

    test('includes .frag and .vert extensions', () => {
      const output = ' D old/effect.frag\n D old/vert.vert\n';
      const result = ShaderGitMetadataProvider.parseDeletedShadersByBasename(output);
      assert.strictEqual(result.get('effect.frag'), 'old/effect.frag');
      assert.strictEqual(result.get('vert.vert'), 'old/vert.vert');
    });

    test('first occurrence wins when basename collision', () => {
      const output = ' D a/foo.glsl\n D b/foo.glsl\n';
      const result = ShaderGitMetadataProvider.parseDeletedShadersByBasename(output);
      assert.strictEqual(result.get('foo.glsl'), 'a/foo.glsl');
    });
  });

  suite('getMetadataForWorkspace — uncommitted move backfill', () => {
    const repoRoot = '/repo';
    const workspaceRoot = '/repo';

    test('transfers createdTime from deleted path to untracked path with same basename', async () => {
      const fs = require('fs');
      sandbox.stub(fs, 'existsSync').returns(false);
      sandbox.stub(fs, 'mkdirSync');
      sandbox.stub(fs, 'writeFileSync');

      const runGit = sandbox.stub();
      runGit.withArgs(sinon.match((args: string[]) => args.includes('--show-toplevel')))
        .resolves(`${repoRoot}\n`);
      runGit.withArgs(sinon.match((args: string[]) => args.includes('rev-parse') && args.includes('HEAD')))
        .resolves('abc123\n');
      // modified log: old path has metadata
      runGit.withArgs(sinon.match((args: string[]) => args.includes('log') && !args.includes('--diff-filter=AR')))
        .resolves('commit:1000\nsrc/draw/circle.glsl\n');
      // created log: old path was added in commit 500
      runGit.withArgs(sinon.match((args: string[]) => args.includes('--diff-filter=AR')))
        .resolves('commit:500\nA\tsrc/draw/circle.glsl\n');
      // status: old path deleted, new path untracked
      runGit.withArgs(sinon.match((args: string[]) => args.includes('status') && args.includes('--porcelain')))
        .resolves(' D src/draw/circle.glsl\n?? src/2024/circle.glsl\n');

      const provider = new ShaderGitMetadataProvider(mockContext as any, runGit);
      // shaderPaths uses the NEW (moved) location
      const result = await provider.getMetadataForWorkspace(workspaceRoot, ['/repo/src/2024/circle.glsl']);

      assert.ok(result !== null);
      const meta = result!.metadataByPath.get('src/2024/circle.glsl');
      assert.ok(meta, 'should have metadata for new path');
      assert.strictEqual(meta!.createdTime, 500_000,
        'should inherit createdTime from deleted path via basename match');
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

  suite('parseGitLogCreated', () => {
    test('simple add — returns created time at added path', () => {
      const output = 'commit:1000\nA\tshaders/foo.glsl\n';
      const result = ShaderGitMetadataProvider.parseGitLogCreated(output);
      assert.strictEqual(result.get('shaders/foo.glsl')?.createdTime, 1_000_000);
    });

    test('rename then add — maps created time to current (renamed) path', () => {
      // git log newest-first: rename happened in commit 2000, original add in commit 1000
      const output = [
        'commit:2000',
        'R100\tshaders/foo.glsl\tshaders/bar/foo.glsl',
        '',
        'commit:1000',
        'A\tshaders/foo.glsl',
        '',
      ].join('\n');
      const result = ShaderGitMetadataProvider.parseGitLogCreated(output);
      assert.strictEqual(result.get('shaders/bar/foo.glsl')?.createdTime, 1_000_000,
        'created time should trace through rename to original add');
      assert.ok(!result.has('shaders/foo.glsl'),
        'old path should not appear in result');
    });

    test('chained renames — traces through multiple renames to original add', () => {
      const output = [
        'commit:3000',
        'R100\tshaders/b.glsl\tshaders/c.glsl',
        '',
        'commit:2000',
        'R100\tshaders/a.glsl\tshaders/b.glsl',
        '',
        'commit:1000',
        'A\tshaders/a.glsl',
        '',
      ].join('\n');
      const result = ShaderGitMetadataProvider.parseGitLogCreated(output);
      assert.strictEqual(result.get('shaders/c.glsl')?.createdTime, 1_000_000,
        'should trace through two renames to original add time');
    });

    test('no rename — file added directly at current path', () => {
      const output = [
        'commit:5000',
        'A\tshaders/direct.frag',
        '',
      ].join('\n');
      const result = ShaderGitMetadataProvider.parseGitLogCreated(output);
      assert.strictEqual(result.get('shaders/direct.frag')?.createdTime, 5_000_000);
    });

    test('multiple files with mixed adds and renames', () => {
      const output = [
        'commit:3000',
        'R100\tshaders/old.glsl\tshaders/new.glsl',
        '',
        'commit:2000',
        'A\tshaders/other.frag',
        '',
        'commit:1000',
        'A\tshaders/old.glsl',
        '',
      ].join('\n');
      const result = ShaderGitMetadataProvider.parseGitLogCreated(output);
      assert.strictEqual(result.get('shaders/new.glsl')?.createdTime, 1_000_000);
      assert.strictEqual(result.get('shaders/other.frag')?.createdTime, 2_000_000);
    });

    test('normalizes backslashes in paths', () => {
      const output = 'commit:1000\nA\tshaders\\sub\\file.glsl\n';
      const result = ShaderGitMetadataProvider.parseGitLogCreated(output);
      assert.ok(result.has('shaders/sub/file.glsl'));
    });

    test('skips lines before first commit marker', () => {
      const output = 'A\tshaders/orphan.glsl\ncommit:1000\nA\tshaders/foo.glsl\n';
      const result = ShaderGitMetadataProvider.parseGitLogCreated(output);
      assert.ok(!result.has('shaders/orphan.glsl'));
      assert.ok(result.has('shaders/foo.glsl'));
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
