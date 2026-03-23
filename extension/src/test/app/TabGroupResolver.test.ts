import * as assert from 'assert';
import * as vscode from 'vscode';
import { TabGroupResolver } from '../../app/TabGroupResolver';
import type { TabGroupInfo } from '../../app/TabGroupResolver';

function makeTab(label: string, viewType?: string): { label: string; input: unknown } {
    return {
        label,
        input: viewType ? { viewType } : { uri: vscode.Uri.file(`/fake/${label}`) },
    };
}

function makeGroup(viewColumn: vscode.ViewColumn, tabs: { label: string; input: unknown }[]): TabGroupInfo {
    return { viewColumn, tabs };
}

suite('TabGroupResolver', () => {
    suite('isExtensionTab', () => {
        test('detects tab by shader-studio viewType', () => {
            assert.strictEqual(
                TabGroupResolver.isExtensionTab(makeTab('anything', 'shader-studio')),
                true,
            );
        });

        test('detects tab by shader-studio.shaderExplorer viewType', () => {
            assert.strictEqual(
                TabGroupResolver.isExtensionTab(makeTab('anything', 'shader-studio.shaderExplorer')),
                true,
            );
        });

        test('detects tab by shader-studio.snippetLibrary viewType', () => {
            assert.strictEqual(
                TabGroupResolver.isExtensionTab(makeTab('anything', 'shader-studio.snippetLibrary')),
                true,
            );
        });

        test('detects tab by "Shader Studio" label', () => {
            assert.strictEqual(
                TabGroupResolver.isExtensionTab(makeTab('Shader Studio')),
                true,
            );
        });

        test('detects tab by "Shader Explorer" label', () => {
            assert.strictEqual(
                TabGroupResolver.isExtensionTab(makeTab('Shader Explorer')),
                true,
            );
        });

        test('detects tab by "Snippet Library" label', () => {
            assert.strictEqual(
                TabGroupResolver.isExtensionTab(makeTab('Snippet Library')),
                true,
            );
        });

        test('does not match regular text editor tab', () => {
            assert.strictEqual(
                TabGroupResolver.isExtensionTab(makeTab('shader.glsl')),
                false,
            );
        });

        test('does not match unrelated webview tab', () => {
            assert.strictEqual(
                TabGroupResolver.isExtensionTab(makeTab('Preview', 'markdown.preview')),
                false,
            );
        });

        test('handles tab with no input', () => {
            assert.strictEqual(
                TabGroupResolver.isExtensionTab({ label: 'empty', input: undefined }),
                false,
            );
        });
    });

    suite('groupHasExtensionPanel', () => {
        test('returns true when group contains a Shader Studio tab', () => {
            const group = makeGroup(vscode.ViewColumn.Two, [
                makeTab('shader.glsl'),
                makeTab('Shader Studio', 'shader-studio'),
            ]);
            assert.strictEqual(TabGroupResolver.groupHasExtensionPanel(group), true);
        });

        test('returns true when group contains Shader Explorer by label only', () => {
            const group = makeGroup(vscode.ViewColumn.Two, [
                makeTab('shader.glsl'),
                makeTab('Shader Explorer'),
            ]);
            assert.strictEqual(TabGroupResolver.groupHasExtensionPanel(group), true);
        });

        test('returns false when group has only text editors', () => {
            const group = makeGroup(vscode.ViewColumn.One, [
                makeTab('shader.glsl'),
                makeTab('utils.glsl'),
            ]);
            assert.strictEqual(TabGroupResolver.groupHasExtensionPanel(group), false);
        });

        test('returns false for empty group', () => {
            const group = makeGroup(vscode.ViewColumn.One, []);
            assert.strictEqual(TabGroupResolver.groupHasExtensionPanel(group), false);
        });
    });

    suite('resolveColumn', () => {
        let resolver: TabGroupResolver;

        setup(() => {
            resolver = new TabGroupResolver();
        });

        teardown(() => {
            resolver.dispose();
        });

        test('returns Beside when all groups have extension panels', () => {
            const groups = [
                makeGroup(vscode.ViewColumn.One, [makeTab('Shader Studio', 'shader-studio')]),
                makeGroup(vscode.ViewColumn.Two, [makeTab('Shader Explorer', 'shader-studio.shaderExplorer')]),
            ];
            assert.strictEqual(resolver.resolveColumn(groups, undefined), vscode.ViewColumn.Beside);
        });

        test('returns the only eligible group', () => {
            const groups = [
                makeGroup(vscode.ViewColumn.One, [makeTab('shader.glsl')]),
                makeGroup(vscode.ViewColumn.Two, [makeTab('Shader Studio', 'shader-studio')]),
            ];
            assert.strictEqual(resolver.resolveColumn(groups, undefined), vscode.ViewColumn.One);
        });

        test('prefers last active editor column when eligible', () => {
            const groups = [
                makeGroup(vscode.ViewColumn.One, [makeTab('a.glsl')]),
                makeGroup(vscode.ViewColumn.Three, [makeTab('b.glsl')]),
                makeGroup(vscode.ViewColumn.Two, [makeTab('Shader Studio', 'shader-studio')]),
            ];
            assert.strictEqual(
                resolver.resolveColumn(groups, vscode.ViewColumn.Three),
                vscode.ViewColumn.Three,
            );
        });

        test('ignores last active column if that group has extension panel', () => {
            const groups = [
                makeGroup(vscode.ViewColumn.One, [makeTab('a.glsl')]),
                makeGroup(vscode.ViewColumn.Two, [
                    makeTab('b.glsl'),
                    makeTab('Shader Studio', 'shader-studio'),
                ]),
            ];
            // Last active was column 2 which has Shader Studio
            assert.strictEqual(
                resolver.resolveColumn(groups, vscode.ViewColumn.Two),
                vscode.ViewColumn.One,
            );
        });

        test('falls back to first eligible group when last active column not found', () => {
            const groups = [
                makeGroup(vscode.ViewColumn.One, [makeTab('Shader Studio', 'shader-studio')]),
                makeGroup(vscode.ViewColumn.Two, [makeTab('a.glsl')]),
                makeGroup(vscode.ViewColumn.Three, [makeTab('b.glsl')]),
            ];
            // Last active was column 4 which doesn't exist
            assert.strictEqual(
                resolver.resolveColumn(groups, vscode.ViewColumn.Four),
                vscode.ViewColumn.Two,
            );
        });

        test('handles mixed groups with explorer detected by label', () => {
            const groups = [
                makeGroup(vscode.ViewColumn.One, [makeTab('Shader Explorer')]),
                makeGroup(vscode.ViewColumn.Two, [makeTab('Shader Studio')]),
                makeGroup(vscode.ViewColumn.Three, [makeTab('shader.glsl')]),
            ];
            assert.strictEqual(resolver.resolveColumn(groups, undefined), vscode.ViewColumn.Three);
        });

        test('returns Beside when no groups at all', () => {
            assert.strictEqual(resolver.resolveColumn([], undefined), vscode.ViewColumn.Beside);
        });

        test('handles single eligible group with no last active', () => {
            const groups = [
                makeGroup(vscode.ViewColumn.One, [makeTab('shader.glsl'), makeTab('utils.glsl')]),
            ];
            assert.strictEqual(resolver.resolveColumn(groups, undefined), vscode.ViewColumn.One);
        });

        test('excludes group with Snippet Library', () => {
            const groups = [
                makeGroup(vscode.ViewColumn.One, [makeTab('Snippet Library', 'shader-studio.snippetLibrary')]),
                makeGroup(vscode.ViewColumn.Two, [makeTab('shader.glsl')]),
            ];
            assert.strictEqual(resolver.resolveColumn(groups, undefined), vscode.ViewColumn.Two);
        });
    });

    suite('resolveExtensionTabColumn', () => {
        let resolver: TabGroupResolver;

        setup(() => {
            resolver = new TabGroupResolver();
        });

        teardown(() => {
            resolver.dispose();
        });

        test('returns the matching column by viewType', () => {
            const groups = [
                makeGroup(vscode.ViewColumn.One, [makeTab('shader.glsl')]),
                makeGroup(vscode.ViewColumn.Two, [makeTab('Shader Explorer', 'shader-studio.shaderExplorer')]),
            ];

            assert.strictEqual(
                resolver.resolveExtensionTabColumn(
                    groups,
                    ['shader-studio.shaderExplorer'],
                    ['Shader Explorer'],
                    vscode.ViewColumn.One,
                ),
                vscode.ViewColumn.Two,
            );
        });

        test('returns the matching column by label fallback', () => {
            const groups = [
                makeGroup(vscode.ViewColumn.Three, [makeTab('Shader Explorer')]),
            ];

            assert.strictEqual(
                resolver.resolveExtensionTabColumn(
                    groups,
                    ['shader-studio.shaderExplorer'],
                    ['Shader Explorer'],
                    vscode.ViewColumn.One,
                ),
                vscode.ViewColumn.Three,
            );
        });

        test('returns fallback when no matching tab exists', () => {
            const groups = [
                makeGroup(vscode.ViewColumn.Two, [makeTab('shader.glsl')]),
            ];

            assert.strictEqual(
                resolver.resolveExtensionTabColumn(
                    groups,
                    ['shader-studio.shaderExplorer'],
                    ['Shader Explorer'],
                    vscode.ViewColumn.One,
                ),
                vscode.ViewColumn.One,
            );
        });
    });
});
