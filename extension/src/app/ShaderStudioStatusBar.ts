import * as vscode from 'vscode';

export class ShaderStudioStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private isServerRunning: boolean = false;

    constructor(private context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.updateServerStatus(false);
        this.statusBarItem.command = 'shader-studio.showShaderStudioMenu';
        this.statusBarItem.show();
        this.context.subscriptions.push(this.statusBarItem);
    }

    public updateServerStatus(isRunning: boolean, port?: number) {
        this.isServerRunning = isRunning;

        if (isRunning) {
            this.statusBarItem.text = "$(circle-filled) SHA";
            this.statusBarItem.tooltip = `Shader Studio - Server Running${port ? ` on port ${port}` : ''}`;
        } else {
            this.statusBarItem.text = "SHA";
            this.statusBarItem.tooltip = "Shader Studio - Click for options";
        }
    }

    public async showShaderStudioMenu() {
        const items = [];

        if (this.isServerRunning) {
            items.push({
                label: '$(stop-circle) Stop Web Server',
                description: 'Stop the Shader Studio web server',
                action: 'stop-server'
            });
            items.push({
                label: '$(globe) Open in Browser',
                description: 'Open Shader Studio in external browser',
                action: 'open-browser'
            });
            items.push({
                label: '$(copy) Copy URL',
                description: 'Copy server URL to clipboard',
                action: 'copy-url'
            });
        } else {
            items.push({
                label: '$(play-circle) Start Web Server',
                description: 'Start the Shader Studio web server',
                action: 'start-server'
            });
        }

        items.push({
            label: '$(window) Open Panel',
            description: 'Show the Shader Studio panel',
            action: 'show-panel'
        });
        items.push({
            label: '$(multiple-windows) Open Window',
            description: 'Open Shader Studio in a new window',
            action: 'show-window'
        });
        items.push({
            label: '$(library) Shader Explorer',
            description: 'Browse all shaders in workspace',
            action: 'shader explorer'
        });
        items.push({
            label: '$(new-file) New Shader',
            description: 'Create a new shadertoy.glsl file',
            action: 'new-shader'
        });
        items.push({
            label: '$(gear) Settings',
            description: 'Open Shader Studio settings',
            action: 'open-settings'
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Shader Studio Actions',
            title: this.isServerRunning ? 'Server Running' : 'Shader Studio'
        });

        if (selected) {
            switch (selected.action) {
                case 'start-server':
                    await vscode.commands.executeCommand('shader-studio.startWebServer');
                    break;
                case 'stop-server':
                    await vscode.commands.executeCommand('shader-studio.stopWebServer');
                    break;
                case 'open-browser':
                    await vscode.commands.executeCommand('shader-studio.openInBrowser');
                    break;
                case 'copy-url':
                    await vscode.commands.executeCommand('shader-studio.copyServerUrl');
                    break;
                case 'show-panel':
                    await vscode.commands.executeCommand('shader-studio.view');
                    break;
                case 'show-window':
                    await vscode.commands.executeCommand('shader-studio.viewInNewWindow');
                    break;
                case 'shader explorer':
                    await vscode.commands.executeCommand('shader-studio.openShaderExplorer');
                    break;
                case 'new-shader':
                    await vscode.commands.executeCommand('shader-studio.newShader');
                    break;
                case 'open-settings':
                    await vscode.commands.executeCommand('shader-studio.openSettings');
                    break;
            }
        }
    }

    public dispose() {
        this.statusBarItem.dispose();
    }
}
