import * as assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { PathResolver } from '../../app/PathResolver';

suite('PathResolver Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let workspaceGetWorkspaceFolderStub: sinon.SinonStub;

    const WORKSPACE_ROOT = path.join(path.sep, 'workspace');
    const SHADER_DIR = path.join(WORKSPACE_ROOT, 'shaders');

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock vscode.workspace
        workspaceGetWorkspaceFolderStub = sandbox.stub(vscode.workspace, 'getWorkspaceFolder');

        // Default workspace folder mock
        workspaceGetWorkspaceFolderStub.returns({
            uri: { fsPath: WORKSPACE_ROOT },
            name: 'workspace',
            index: 0
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Workspace-relative path (@/ prefix)', () => {
        test('should resolve @/buffers/test.glsl from workspace root', () => {
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const configPath = '@/buffers/test.glsl';
            const expectedPath = path.join(WORKSPACE_ROOT, 'buffers', 'test.glsl');
            
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            assert.strictEqual(result, expectedPath);
        });

        test('should resolve nested @/ path from workspace root', () => {
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const configPath = '@/assets/shaders/common.glsl';
            const expectedPath = path.join(WORKSPACE_ROOT, 'assets', 'shaders', 'common.glsl');
            
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            assert.strictEqual(result, expectedPath);
        });
    });

    suite('Absolute paths', () => {
        test('should use platform absolute path as-is', () => {
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const absolutePath = path.join(path.sep, 'absolute', 'path', 'buffer.glsl');
            
            const result = PathResolver.resolvePath(shaderPath, absolutePath);
            
            assert.strictEqual(result, absolutePath);
        });

        test('should use Unix-style absolute path as-is', () => {
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const absolutePath = path.posix.join('/', 'usr', 'local', 'shaders', 'buffer.glsl');
            
            const result = PathResolver.resolvePath(shaderPath, absolutePath);
            
            assert.strictEqual(result, absolutePath);
        });

        test('should handle Windows drive letter paths', function() {
            // This test only makes sense on Windows
            if (process.platform !== 'win32') {
                this.skip();
                return;
            }
            
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const absolutePath = 'C:\\absolute\\path\\buffer.glsl';
            
            const result = PathResolver.resolvePath(shaderPath, absolutePath);
            
            assert.strictEqual(result, absolutePath);
        });
    });

    suite('Relative paths (shader file directory)', () => {
        test('should resolve relative path from shader file directory', () => {
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const configPath = '../buffers/test.glsl';
            const expectedPath = path.normalize(path.join(SHADER_DIR, '..', 'buffers', 'test.glsl'));
            
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            assert.strictEqual(result, expectedPath);
        });

        test('should resolve same directory relative path', () => {
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const configPath = 'buffer.glsl';
            const expectedPath = path.join(SHADER_DIR, 'buffer.glsl');
            
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            assert.strictEqual(result, expectedPath);
        });

        test('should resolve subdirectory relative path', () => {
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const configPath = 'common/utils.glsl';
            const expectedPath = path.join(SHADER_DIR, 'common', 'utils.glsl');
            
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            assert.strictEqual(result, expectedPath);
        });

        test('should resolve multiple parent directory traversal', () => {
            const shaderPath = path.join(SHADER_DIR, 'effects', 'blur.glsl');
            const configPath = '../../buffers/test.glsl';
            const expectedPath = path.normalize(path.join(SHADER_DIR, 'effects', '..', '..', 'buffers', 'test.glsl'));
            
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            assert.strictEqual(result, expectedPath);
        });
    });

    suite('Mixed path scenarios', () => {
        test('should handle @/ with nested directories', () => {
            const shaderPath = path.join(SHADER_DIR, 'effects', 'advanced', 'bloom.glsl');
            const configPath = '@/common/buffers/temp.glsl';
            const expectedPath = path.join(WORKSPACE_ROOT, 'common', 'buffers', 'temp.glsl');
            
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            assert.strictEqual(result, expectedPath);
        });

        test('should handle relative path with ./', () => {
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const configPath = './buffer.glsl';
            const expectedPath = path.join(SHADER_DIR, 'buffer.glsl');
            
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            assert.strictEqual(path.normalize(result), path.normalize(expectedPath));
        });

        test('should preserve path separators correctly', () => {
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const configPath = '@/assets/textures/wood.png';
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            // Ensure the result is a properly formed path for the current platform
            assert.ok(result.includes('assets'));
            assert.ok(result.includes('textures'));
            assert.ok(result.includes('wood.png'));
        });
    });

    suite('Edge cases', () => {
        test('should handle empty relative path components', () => {
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const configPath = 'common//buffer.glsl';
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            // path.join should normalize this
            assert.ok(result.includes('common'));
            assert.ok(result.includes('buffer.glsl'));
        });

        test('should handle workspace root at drive root', () => {
            const rootWorkspace = path.sep;
            const shaderPath = path.join(rootWorkspace, 'shader.glsl');
            const configPath = '@/buffer.glsl';
            const expectedPath = path.join(rootWorkspace, 'buffer.glsl');
            
            // Update workspace folder mock for this test
            workspaceGetWorkspaceFolderStub.returns({
                uri: { fsPath: rootWorkspace },
                name: 'workspace',
                index: 0
            });
            
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            assert.strictEqual(result, expectedPath);
        });

        test('should handle deeply nested shader file', () => {
            const deepShaderPath = path.join(WORKSPACE_ROOT, 'a', 'b', 'c', 'd', 'shader.glsl');
            const configPath = '../../buffer.glsl';
            const expectedPath = path.normalize(path.join(WORKSPACE_ROOT, 'a', 'b', 'c', 'd', '..', '..', 'buffer.glsl'));
            
            const result = PathResolver.resolvePath(deepShaderPath, configPath);
            
            assert.strictEqual(result, expectedPath);
        });

        test('should fallback to shader directory when no workspace', () => {
            const shaderPath = path.join(SHADER_DIR, 'main.glsl');
            const configPath = '@/buffers/test.glsl';
            
            // Mock no workspace folder
            workspaceGetWorkspaceFolderStub.returns(undefined);
            
            // Should use shader directory as fallback
            const expectedPath = path.join(SHADER_DIR, 'buffers', 'test.glsl');
            const result = PathResolver.resolvePath(shaderPath, configPath);
            
            assert.strictEqual(result, expectedPath);
        });
    });
});
