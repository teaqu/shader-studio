import * as vscode from 'vscode';

export class ShaderViewStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private isServerRunning: boolean = false;

  constructor(private context: vscode.ExtensionContext) {
    // Create status bar item that's always visible
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 
      100 // High priority to keep it visible
    );
    this.updateServerStatus(false);
    this.statusBarItem.command = 'shader-view.showShaderViewMenu';
    this.statusBarItem.show();
    this.context.subscriptions.push(this.statusBarItem);
  }

  public updateServerStatus(isRunning: boolean, port?: number) {
    this.isServerRunning = isRunning;
    
    if (isRunning) {
      this.statusBarItem.text = "$(circle-filled) SV";
      this.statusBarItem.tooltip = `Shader View - Server Running${port ? ` on port ${port}` : ''}`;
    } else {
      this.statusBarItem.text = "SV";
      this.statusBarItem.tooltip = "Shader View - Click for options";
    }
  }

  public async showShaderViewMenu() {
    const items = [];

    if (this.isServerRunning) {
      items.push({
        label: '$(stop-circle) Stop Web Server',
        description: 'Stop the Shader View web server',
        action: 'stop-server'
      });
      items.push({
        label: '$(globe) Open in Browser',
        description: 'Open Shader View in external browser',
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
        description: 'Start the Shader View web server',
        action: 'start-server'
      });
    }

    items.push({
      label: '$(window) Show Panel',
      description: 'Show the Shader View panel',
      action: 'show-panel'
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Shader View Actions',
      title: this.isServerRunning ? 'Server Running' : 'Shader View'
    });

    if (selected) {
      switch (selected.action) {
        case 'start-server':
          await vscode.commands.executeCommand('shader-view.startWebServer');
          break;
        case 'stop-server':
          await vscode.commands.executeCommand('shader-view.stopWebServer');
          break;
        case 'open-browser':
          await vscode.commands.executeCommand('shader-view.openInBrowser');
          break;
        case 'copy-url':
          await vscode.commands.executeCommand('shader-view.copyServerUrl');
          break;
        case 'show-panel':
          await vscode.commands.executeCommand('shader-view.view');
          break;
      }
    }
  }

  public dispose() {
    this.statusBarItem.dispose();
  }
}
