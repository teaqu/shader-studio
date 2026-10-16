/** Open the shader's preview after the preceding test closed its editors.
 * A disposed panel's canvas iframe can remain in the workbench during teardown;
 * discovering that iframe does not mean the next shader has a live preview. */
export async function openShaderView(vscode) {
  await vscode.evaluateInHost(async vscode => vscode.commands.executeCommand('shader-studio.view'));
}
