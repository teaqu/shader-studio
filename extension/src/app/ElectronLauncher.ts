import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
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
      this.logger.info(
        `Attempting to launch Electron (always on top) with local UI`,
      );
      this.logger.info(`Development mode: ${isDevelopment}`);
      this.logger.info(`Extension mode: ${this.context.extensionMode}`);

      const { electronDir, launcherScript } = await this.findElectronApp();

      // Always use npx electron for simplicity and reliability
      this.logger.info("Using npx electron for all launches");
      await this.launchWithNpx(electronDir, launcherScript);
    } catch (error) {
      this.logger.error(`Failed to launch Electron: ${error}`);
      vscode.window.showErrorMessage(`Failed to launch Electron: ${error}`);
    }
  }

  private async findElectronApp(): Promise<
    { electronDir: string; launcherScript: string }
  > {
    const extensionDir = this.context.extensionUri.fsPath;
    const electronAppPath = path.join(extensionDir, "electron-app");
    const launcherScript = path.join(
      electronAppPath,
      "dist",
      "electron-launch.js",
    );

    // Try bundled electron app first
    if (fs.existsSync(launcherScript)) {
      this.logger.info(`Using bundled electron app at: ${launcherScript}`);
      return { electronDir: electronAppPath, launcherScript };
    }

    // Log detailed info for debugging
    await this.logDirectoryContents(extensionDir, electronAppPath);

    // Fallback to workspace electron directory
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      const workspaceElectronDir = path.join(workspaceRoot, "electron");
      const workspaceLauncherScript = path.join(
        workspaceElectronDir,
        "dist",
        "electron-launch.js",
      );

      if (fs.existsSync(workspaceLauncherScript)) {
        this.logger.info(
          `Using workspace electron app at: ${workspaceLauncherScript}`,
        );
        return {
          electronDir: workspaceElectronDir,
          launcherScript: workspaceLauncherScript,
        };
      }

      throw new Error(
        `No electron app found. Tried bundled (${launcherScript}) and workspace (${workspaceLauncherScript})`,
      );
    }

    throw new Error(`No workspace found and no bundled electron app available`);
  }

  private async logDirectoryContents(
    extensionDir: string,
    electronAppPath: string,
  ): Promise<void> {
    this.logger.warn(`Bundled electron app not found`);
    this.logger.info(`Extension dir: ${extensionDir}`);
    this.logger.info(`Electron app path: ${electronAppPath}`);

    try {
      const extensionContents = await fs.promises.readdir(extensionDir);
      this.logger.info(
        `Extension directory contents: ${extensionContents.join(", ")}`,
      );

      if (extensionContents.includes("electron-app")) {
        const electronAppContents = await fs.promises.readdir(electronAppPath);
        this.logger.info(
          `Electron app directory contents: ${electronAppContents.join(", ")}`,
        );

        if (electronAppContents.includes("dist")) {
          const distPath = path.join(electronAppPath, "dist");
          const distContents = await fs.promises.readdir(distPath);
          this.logger.info(
            `Electron app dist directory contents: ${distContents.join(", ")}`,
          );
        }
      }
    } catch (listError) {
      this.logger.warn(`Could not list directory contents: ${listError}`);
    }
  }

  private async launchWithNpx(
    electronDir: string,
    launcherScript: string,
  ): Promise<void> {
    const terminal = vscode.window.createTerminal({
      name: `Shader View Electron ${Date.now()}`,
      cwd: electronDir,
      hideFromUser: false,
    });

    const command = `npx electron "${launcherScript}"`;
    terminal.sendText(command);

    this.logger.info(
      `Opened VS Code terminal to launch Electron with command: ${command}`,
    );
  }
}
