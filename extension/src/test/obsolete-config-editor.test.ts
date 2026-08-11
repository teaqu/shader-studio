import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface CommandContribution {
  command: string;
}

suite('Obsolete config editor surface', () => {
  test('does not contribute the retired direct config editor surface', () => {
    const extensionManifest = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'package.json'),
      'utf8',
    ));
    const rootManifest = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'package.json'),
      'utf8',
    ));
    const commands = extensionManifest.contributes.commands.map(
      ({ command }: CommandContribution) => command,
    );

    assert.ok(
      !('shader-studio.defaultConfigView'
        in extensionManifest.contributes.configuration.properties),
    );
    assert.ok(!commands.includes('shader-studio.toggleConfigView'));
    assert.ok(!commands.includes('shader-studio.toggleConfigViewToSource'));
    assert.ok(!commands.includes('shader-studio.updateEditorPriority'));
    assert.ok(!rootManifest.workspaces.includes('config-ui'));
  });
});
