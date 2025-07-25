import * as vscode from "vscode";
import { Logger } from "./services/Logger";

export class ElectronLauncher {
  private logger: Logger;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext, logger: Logger) {
    this.context = context;
    this.logger = logger;
  }

  public async launch(isDevelopment: boolean): Promise<void> {
    try {
      const path = await import('path');

      this.logger.info(`Attempting to launch Electron (always on top) with local UI`);

      const extensionDir = this.context.extensionUri.fsPath;
      const rootDir = path.dirname(extensionDir);
      const electronDir = path.join(rootDir, 'electron');
      const launcherScript = path.join(electronDir, 'dist', 'electron-launch.js');

      if (isDevelopment) {
        await this.launchDevelopmentMode(electronDir, launcherScript);
      } else {
        try {
          await this.launchProductionMode(electronDir);
        } catch (productionError) {
          this.logger.warn(`Production mode failed: ${productionError}`);
          this.logger.info('Falling back to development mode...');
          await this.launchDevelopmentMode(electronDir, launcherScript);
        }
      }

    } catch (error) {
      this.logger.error(`Failed to launch Electron: ${error}`);
      vscode.window.showErrorMessage(`Failed to launch Electron: ${error}`);
    }
  }

  private async launchDevelopmentMode(
    electronDir: string,
    launcherScript: string
  ): Promise<void> {
    this.logger.info('Development mode detected - using npx electron');

    const terminal = vscode.window.createTerminal({
      name: 'Open in Electron',
      cwd: electronDir,
      hideFromUser: true
    });
    terminal.sendText(`npx electron "${launcherScript}"`);

    this.logger.info('Opened VS Code terminal to launch Electron with always-on-top.');
  }

  private async launchProductionMode(electronDir: string): Promise<void> {
    const path = await import('path');
    const fs = await import('fs');

    const platform = process.platform;
    let appPath: string | undefined;

    if (platform === 'darwin') {
      appPath = path.join(electronDir, 'out', 'Shader View-darwin-arm64', 'Shader View.app');
      // Also try x64 if arm64 doesn't exist
      try {
        await fs.promises.access(appPath);
      } catch {
        appPath = path.join(electronDir, 'out', 'Shader View-darwin-x64', 'Shader View.app');
      }
    } else if (platform === 'win32') {
      appPath = path.join(electronDir, 'out', 'Shader View-win32-x64', 'Shader View.exe');
    } else if (platform === 'linux') {
      appPath = path.join(electronDir, 'out', 'Shader View-linux-x64', 'shader-view-electron');
    }

    if (appPath) {
      try {
        await fs.promises.access(appPath);
        this.logger.info(`Launching packaged app from: ${appPath}`);

        const terminal = vscode.window.createTerminal({
          name: 'Open in Electron',
          hideFromUser: true
        });

        if (platform === 'darwin') {
          terminal.sendText(`open "${appPath}"`);
        } else {
          terminal.sendText(`"${appPath}"`);
        }

        vscode.window.showInformationMessage('Launched packaged Electron app (always on top) with local UI');
      } catch {
        throw new Error(`Packaged app not found at: ${appPath}. Please run 'npx electron-forge make' in the electron directory first.`);
      }
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}
