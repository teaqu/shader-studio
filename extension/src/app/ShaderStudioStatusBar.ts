import * as vscode from 'vscode';

export class ShaderStudioStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private configToggleStatusBarItem: vscode.StatusBarItem;
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

        this.configToggleStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99
        );
        this.configToggleStatusBarItem.command = 'shader-studio.toggleConfigView';
        this.context.subscriptions.push(this.configToggleStatusBarItem);

        this.context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                this.updateConfigToggleVisibility();
            })
        );

        this.context.subscriptions.push(
            vscode.window.tabGroups.onDidChangeTabs(() => {
                this.updateConfigToggleVisibility();
            })
        );

        this.context.subscriptions.push(
            vscode.window.tabGroups.onDidChangeTabGroups(() => {
                this.updateConfigToggleVisibility();
            })
        );

        // Initial update
        this.updateConfigToggleVisibility();
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
            label: '$(window) Show Panel',
            description: 'Show the Shader Studio panel',
            action: 'show-panel'
        });
        items.push({
            label: '$(device-desktop) Open in new window',
            description: 'Launch Shader Studio in it\'s own window',
            action: 'open-electron'
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
                case 'open-electron':
                    await vscode.commands.executeCommand('shader-studio.openInElectron');
                    break;
            }
        }
    }

    public refreshConfigToggle() {
        this.updateConfigToggleVisibility();
    }

    private updateConfigToggleVisibility() {
        const activeEditor = vscode.window.activeTextEditor;
        const currentTab = vscode.window.tabGroups.activeTabGroup.activeTab;

        let isSvJsonFile = false;
        let isCustomEditor = false;

        if (activeEditor && activeEditor.document.fileName.endsWith('.sha.json')) {
            isSvJsonFile = true;
            isCustomEditor = false;
        } else if (currentTab?.input instanceof vscode.TabInputCustom &&
            (currentTab.input as vscode.TabInputCustom).viewType === 'shader-studio.configEditor') {
            isSvJsonFile = true;
            isCustomEditor = true;
        }

        if (isSvJsonFile) {
            if (isCustomEditor) {
                this.configToggleStatusBarItem.text = "$(file-code) JSON";
                this.configToggleStatusBarItem.tooltip = "Click to view/edit JSON directly";
            } else {
                this.configToggleStatusBarItem.text = "$(symbol-misc) UI";
                this.configToggleStatusBarItem.tooltip = "Click to use visual config editor";
            }

            this.configToggleStatusBarItem.show();
        } else {
            this.configToggleStatusBarItem.hide();
        }
    }

    public dispose() {
        this.statusBarItem.dispose();
        this.configToggleStatusBarItem.dispose();
    }
}
