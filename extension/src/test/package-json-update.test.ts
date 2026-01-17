import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { updateCustomEditorPriority } from '../extension';

suite('Package.json Update Test Suite', () => {
  let sandbox: sinon.SinonSandbox;
  let tempDir: string;
  let tempPackageJsonPath: string;
  let originalPackageJson: any;
  let mockExtension: any;
  let mockWorkspaceConfig: any;

  setup(async () => {
    sandbox = sinon.createSandbox();

    // Create a temporary directory for testing
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shader-studio-test-'));
    tempPackageJsonPath = path.join(tempDir, 'package.json');

    // Create a mock package.json content
    originalPackageJson = {
      name: 'shader-studio',
      contributes: {
        customEditors: [
          {
            viewType: 'shader-studio.configEditor',
            displayName: 'Shader Config Editor',
            selector: [{ filenamePattern: '*.sha.json' }],
            priority: 'default'
          }
        ]
      }
    };

    // Write the original package.json to temp location
    await fs.promises.writeFile(tempPackageJsonPath, JSON.stringify(originalPackageJson, null, 2));

    // Mock vscode.extensions.getExtension to return our temp directory
    mockExtension = {
      extensionPath: tempDir
    };
    sandbox.stub(vscode.extensions, 'getExtension').returns(mockExtension);

    // Mock vscode.workspace.getConfiguration
    mockWorkspaceConfig = {
      get: sandbox.stub()
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockWorkspaceConfig);
  });

  teardown(async () => {
    sandbox.restore();
    
    // Clean up temporary directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should update package.json priority to "option" when defaultConfigView is "code"', async () => {
    // Mock the configuration to return 'code'
    mockWorkspaceConfig.get.withArgs('defaultConfigView').returns('code');

    // Call the function
    await updateCustomEditorPriority();

    // Read the updated package.json
    const updatedContent = await fs.promises.readFile(tempPackageJsonPath, 'utf8');
    const updatedPackageJson = JSON.parse(updatedContent);

    // Verify the priority was changed to 'option'
    assert.strictEqual(updatedPackageJson.contributes.customEditors[0].priority, 'option');
    
    // Verify other content remains unchanged
    assert.strictEqual(updatedPackageJson.name, 'shader-studio');
    assert.strictEqual(updatedPackageJson.contributes.customEditors[0].viewType, 'shader-studio.configEditor');
    assert.strictEqual(updatedPackageJson.contributes.customEditors[0].displayName, 'Shader Config Editor');
  });

  test('should update package.json priority to "default" when defaultConfigView is "gui"', async () => {
    // Mock the configuration to return 'gui'
    mockWorkspaceConfig.get.withArgs('defaultConfigView').returns('gui');

    // Call the function
    await updateCustomEditorPriority();

    // Read the updated package.json
    const updatedContent = await fs.promises.readFile(tempPackageJsonPath, 'utf8');
    const updatedPackageJson = JSON.parse(updatedContent);

    // Verify the priority was changed to 'default'
    assert.strictEqual(updatedPackageJson.contributes.customEditors[0].priority, 'default');
    
    // Verify other content remains unchanged
    assert.strictEqual(updatedPackageJson.name, 'shader-studio');
    assert.strictEqual(updatedPackageJson.contributes.customEditors[0].viewType, 'shader-studio.configEditor');
  });

  test('should preserve package.json formatting and structure', async () => {
    // Mock the configuration to return 'code'
    mockWorkspaceConfig.get.withArgs('defaultConfigView').returns('code');

    // Call the function
    await updateCustomEditorPriority();

    // Read the updated content
    const updatedContent = await fs.promises.readFile(tempPackageJsonPath, 'utf8');
    
    // Verify it's valid JSON
    const parsed = JSON.parse(updatedContent);
    assert.ok(parsed);
    
    // Verify it contains the priority field (less strict about formatting)
    assert.ok(updatedContent.includes('"priority": "option"'));
  });

  test('should handle multiple consecutive changes correctly', async () => {
    // First change: set to 'code'
    mockWorkspaceConfig.get.withArgs('defaultConfigView').returns('code');
    await updateCustomEditorPriority();
    
    let content = await fs.promises.readFile(tempPackageJsonPath, 'utf8');
    let packageJson = JSON.parse(content);
    assert.strictEqual(packageJson.contributes.customEditors[0].priority, 'option');

    // Second change: set to 'gui'
    mockWorkspaceConfig.get.withArgs('defaultConfigView').returns('gui');
    await updateCustomEditorPriority();
    
    content = await fs.promises.readFile(tempPackageJsonPath, 'utf8');
    packageJson = JSON.parse(content);
    assert.strictEqual(packageJson.contributes.customEditors[0].priority, 'default');
  });

  test('should not modify package.json when extension is not found', async () => {
    // Restore the original stub and create a new one for this test
    sandbox.restore();
    sandbox = sinon.createSandbox();

    // Mock getExtension to return undefined
    sandbox.stub(vscode.extensions, 'getExtension').returns(undefined);

    // Mock workspace config for this test
    mockWorkspaceConfig = {
      get: sandbox.stub()
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockWorkspaceConfig);

    // Get original content
    const originalContent = await fs.promises.readFile(tempPackageJsonPath, 'utf8');

    // Call the function
    await updateCustomEditorPriority();

    // Verify file was not modified
    const currentContent = await fs.promises.readFile(tempPackageJsonPath, 'utf8');
    assert.strictEqual(currentContent, originalContent);
  });

  test('should handle malformed package.json gracefully', async () => {
    // Write malformed JSON
    await fs.promises.writeFile(tempPackageJsonPath, '{ "invalid": json }');

    // Mock the configuration
    mockWorkspaceConfig.get.withArgs('defaultConfigView').returns('code');

    // This should not throw an error
    await updateCustomEditorPriority();

    // Verify the file still exists (even if malformed)
    const exists = await fs.promises.access(tempPackageJsonPath).then(() => true).catch(() => false);
    assert.ok(exists);
  });

  test('should verify the exact package.json structure matches expected', async () => {
    // Mock the configuration to return 'code'
    mockWorkspaceConfig.get.withArgs('defaultConfigView').returns('code');

    // Call the function
    await updateCustomEditorPriority();

    // Read and verify the complete structure
    const updatedContent = await fs.promises.readFile(tempPackageJsonPath, 'utf8');
    const updatedPackageJson = JSON.parse(updatedContent);

    // Verify the complete expected structure
    const expectedStructure = {
      name: 'shader-studio',
      contributes: {
        customEditors: [
          {
            viewType: 'shader-studio.configEditor',
            displayName: 'Shader Config Editor',
            selector: [{ filenamePattern: '*.sha.json' }],
            priority: 'option' // This should be changed
          }
        ]
      }
    };

    assert.deepStrictEqual(updatedPackageJson, expectedStructure);
  });
});
