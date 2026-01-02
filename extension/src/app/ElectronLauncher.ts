import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as child_process from "child_process";
import { Logger } from "./services/Logger";
import AdmZip from "adm-zip";

export class ElectronLauncher {
  private logger: Logger;
  private context: vscode.ExtensionContext;
  private static downloadedElectronPath: string | null = null;
  private static downloadInProgress: Promise<string> | null = null;

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
        this.logger.info("Using downloaded Electron for packaged extension");
        await this.launchWithDownloadedElectron(electronDir, launcherScript);
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
      name: `Shader Studio Dev ${Date.now()}`,
      cwd: electronDir,
      hideFromUser: true,
    });

    const config = vscode.workspace.getConfiguration("shader-studio");
    const webSocketPort = config.get<number>("webSocketPort") || 51472;

    const command = `npx electron "${launcherScript}" --wsPort=${webSocketPort}`;
    terminal.sendText(command);

    this.logger.info(
      `Opened VS Code terminal to launch Electron with command: ${command}`,
    );
  }

  private async launchWithDownloadedElectron(
    electronDir: string,
    launcherScript: string,
  ): Promise<void> {
    const electronPath = await this.getOrDownloadElectron();

    this.logger.info(`Launching with Electron from: ${electronPath}`);

    // Verify the launcher script exists
    await this.verifyLauncherScript(launcherScript);

    // Apply macOS-specific fixes if needed
    await this.ensureMacOSExecutable(electronPath);

    // Launch in terminal with platform-appropriate command
    const terminal = vscode.window.createTerminal({
      name: `Shader Studio Electron ${Date.now()}`,
      cwd: electronDir,
      hideFromUser: true,
    });

    const command = this.buildLaunchCommand(electronPath, launcherScript);
    terminal.sendText(command);

    this.logger.info(
      `Opened VS Code terminal to launch downloaded Electron with command: ${command}`,
    );
  }

  private buildLaunchCommand(electronPath: string, launcherScript: string): string {
    const platform = process.platform;
    const config = vscode.workspace.getConfiguration("shader-studio");
    const webSocketPort = config.get<number>("webSocketPort") || 51472;

    if (platform === "win32") {
      // PowerShell syntax
      return `& "${electronPath}" "${launcherScript}" --wsPort=${webSocketPort}`;
    } else {
      // Unix-like systems (macOS, Linux) - bash/zsh syntax
      return `"${electronPath}" "${launcherScript}" --wsPort=${webSocketPort}`;
    }
  }

  private async ensureMacOSExecutable(executablePath: string): Promise<void> {
    if (process.platform === "darwin") {
      try {
        // Remove quarantine attribute that might prevent execution
        await this.runCommand(`xattr -rd com.apple.quarantine "${executablePath}" 2>/dev/null || true`);

        // Ensure executable permissions
        await this.runCommand(`chmod +x "${executablePath}"`);

        this.logger.info("Applied macOS executable permissions and removed quarantine");
      } catch (error) {
        this.logger.warn(`Could not apply macOS fixes: ${error}`);
      }
    }
  }

  private async runCommand(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      child_process.exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private async getOrDownloadElectron(): Promise<string> {
    // Use cached download if available
    if (ElectronLauncher.downloadedElectronPath) {
      this.logger.info(`Using cached Electron executable: ${ElectronLauncher.downloadedElectronPath}`);
      return ElectronLauncher.downloadedElectronPath;
    }

    // Check if download is already in progress
    if (ElectronLauncher.downloadInProgress) {
      this.logger.info("Download already in progress, waiting...");
      return await ElectronLauncher.downloadInProgress;
    }

    // Start new download
    const electronVersion = await this.getElectronVersion();
    ElectronLauncher.downloadInProgress = this.downloadElectron(electronVersion);
    const electronPath = await ElectronLauncher.downloadInProgress;
    ElectronLauncher.downloadedElectronPath = electronPath;
    ElectronLauncher.downloadInProgress = null;

    return electronPath;
  }

  private async verifyLauncherScript(launcherScript: string): Promise<void> {
    try {
      await fs.promises.access(launcherScript, fs.constants.F_OK);
      this.logger.info(`Launcher script verified at: ${launcherScript}`);
    } catch (error) {
      throw new Error(`Launcher script not found at ${launcherScript}: ${error}`);
    }
  }

  private async getElectronVersion(): Promise<string> {
    // Try bundled electron app first
    const extensionDir = this.context.extensionUri.fsPath;
    const electronAppDir = path.join(extensionDir, "electron-app");
    const bundledVersion = this.readElectronVersionFromPackageJson(
      path.join(electronAppDir, "package.json")
    );
    if (bundledVersion) {
      return bundledVersion;
    }

    // Fallback to workspace electron directory
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      const workspaceVersion = this.readElectronVersionFromPackageJson(
        path.join(workspaceRoot, "electron", "package.json")
      );
      if (workspaceVersion) {
        return workspaceVersion;
      }
    }

    // Default fallback
    this.logger.info("Using default Electron version 32.0.0");
    return "32.0.0";
  }

  private readElectronVersionFromPackageJson(packageJsonPath: string): string | null {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const electronVersion = packageJson.devDependencies?.electron || packageJson.dependencies?.electron;
      if (electronVersion) {
        // Remove ^ or ~ prefix
        return electronVersion.replace(/^[\^~]/, "");
      }
    } catch (error) {
      this.logger.debug(`Could not read electron version from ${packageJsonPath}: ${error}`);
    }
    return null;
  }

  private async downloadElectron(version: string): Promise<string> {
    const electronGet = await import("@electron/get");

    this.logger.info(
      `Downloading/checking cache for Electron ${version} for platform ${process.platform} arch ${process.arch}...`,
    );

    try {
      const downloadPath = await electronGet.downloadArtifact({
        version,
        artifactName: "electron",
        platform: process.platform as any,
        arch: process.arch as any,
      });

      this.logger.info(`Electron path: ${downloadPath}`);

      if (downloadPath.endsWith(".zip")) {
        return await this.handleZipExtraction(downloadPath);
      }

      await this.logDirectoryContentsIfPossible(downloadPath, "Download directory");
      return this.findElectronExecutable(downloadPath);
    } catch (error) {
      this.logger.error(`Failed to download Electron: ${error}`);
      throw new Error(`Failed to download Electron: ${error}`);
    }
  }

  private async handleZipExtraction(downloadPath: string): Promise<string> {
    const extractDir = downloadPath.replace(".zip", "-extracted");
    this.logger.info(`Download path is a zip file, checking extraction at: ${extractDir}`);

    // Check if already extracted and valid
    if (fs.existsSync(extractDir)) {
      this.logger.info(`Extraction directory already exists, checking for executable`);
      try {
        const executablePath = await this.findElectronExecutable(extractDir);
        this.logger.info(`Using cached extracted Electron at: ${executablePath}`);
        return executablePath;
      } catch (error) {
        this.logger.warn(`Cached extraction invalid, re-extracting: ${error}`);
        await this.removeDirectorySafely(extractDir);
      }
    }

    // Extract the zip file
    this.logger.info(`Extracting to: ${extractDir}`);
    await this.extractZip(downloadPath, extractDir);
    await this.logDirectoryContentsIfPossible(extractDir, "Extracted directory");
    return this.findElectronExecutable(extractDir);
  }

  private async removeDirectorySafely(dir: string): Promise<void> {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch (removeError) {
      this.logger.warn(`Could not remove directory ${dir}: ${removeError}`);
    }
  }

  private async logDirectoryContentsIfPossible(dir: string, label: string): Promise<void> {
    try {
      const contents = await fs.promises.readdir(dir);
      this.logger.info(`${label} contents: ${contents.join(", ")}`);
    } catch (error) {
      this.logger.warn(`Could not list ${label.toLowerCase()}: ${error}`);
    }
  }

  private async extractZip(zipPath: string, extractDir: string): Promise<void> {
    try {
      this.logger.info(`Extracting ${zipPath} to ${extractDir}`);

      // Ensure target directory exists and is empty
      await this.removeDirectorySafely(extractDir);
      await fs.promises.mkdir(extractDir, { recursive: true });

      // Log directory permissions and state
      try {
        const stat = await fs.promises.stat(extractDir);
        this.logger.info(`Extract dir exists. Mode: ${stat.mode.toString(8)}, Owner: ${stat.uid}`);
      } catch (e) {
        this.logger.warn(`Could not stat extract dir: ${e}`);
      }

      // Use adm-zip for cross-platform extraction
      this.logger.info("Using adm-zip for cross-platform zip extraction");
      try {
        const zip = new AdmZip(zipPath);
        
        this.logger.info(`Found ${zip.getEntries().length} entries in zip`);
        
        // On Windows, extractAllTo may fail due to chmod issues
        // Use manual extraction with error handling for each entry
        for (const entry of zip.getEntries()) {
          try {
            if (entry.isDirectory) {
              await fs.promises.mkdir(path.join(extractDir, entry.entryName), { recursive: true });
            } else {
              const targetPath = path.join(extractDir, entry.entryName);
              await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
              await fs.promises.writeFile(targetPath, entry.getData());
              this.logger.debug(`Extracted: ${entry.entryName}`);
            }
          } catch (entryError) {
            // Log but continue - some files may fail but shouldn't block entire extraction
            this.logger.warn(`Failed to extract entry ${entry.entryName}: ${entryError}`);
          }
        }
        
        this.logger.info("Zip extraction completed with adm-zip");

        // Fix permissions on macOS after extraction
        if (process.platform === "darwin") {
          await this.fixMacOSElectronApp(extractDir);
        }
      } catch (admZipError) {
        this.logger.error(`adm-zip extraction failed: ${admZipError}`);
        this.logger.error(`Stack: ${admZipError instanceof Error ? admZipError.stack : 'no stack'}`);
        throw admZipError;
      }

    } catch (error) {
      this.logger.error(`Extraction failed: ${error}`);
      this.logger.error(`Stack trace: ${error instanceof Error ? error.stack : 'no stack'}`);
      throw error;
    }
  }

  private async findElectronExecutable(downloadPath: string): Promise<string> {
    const platform = process.platform;
    const executablePath = this.getExpectedExecutablePath(downloadPath, platform);

    this.logger.info(`Expected executable path: ${executablePath}`);

    // Check if the executable exists at the expected path
    if (await this.isValidExecutable(executablePath)) {
      return executablePath;
    }

    // Search for executable in the download directory
    this.logger.info(`Searching for electron executable in: ${downloadPath}`);
    const foundPath = await this.searchForExecutable(downloadPath, platform);

    if (foundPath) {
      this.logger.info(`Found electron executable at: ${foundPath}`);
      return foundPath;
    }

    throw new Error(`Could not locate electron executable in ${downloadPath}`);
  }

  private getExpectedExecutablePath(downloadPath: string, platform: string): string {
    if (platform === "win32") {
      return path.join(downloadPath, "electron.exe");
    } else if (platform === "darwin") {
      return path.join(downloadPath, "Electron.app", "Contents", "MacOS", "Electron");
    } else {
      return path.join(downloadPath, "electron");
    }
  }

  private async isValidExecutable(executablePath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(executablePath);
      if (stats.isFile() && stats.size > 0) {
        this.logger.info(`Executable found, size: ${stats.size} bytes`);
        return true;
      }
    } catch (error) {
      this.logger.debug(`Executable not found at expected path: ${error}`);
    }
    return false;
  }

  private async searchForExecutable(dir: string, platform: string): Promise<string | null> {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isFile()) {
          if ((platform === "win32" && entry.name === "electron.exe") ||
            (platform !== "win32" && entry.name === "electron")) {
            return fullPath;
          }
        } else if (entry.isDirectory()) {
          const found = await this.searchForExecutable(fullPath, platform);
          if (found) {
            return found;
          }
        }
      }
    } catch (error) {
      this.logger.debug(`Error searching in ${dir}: ${error}`);
    }
    return null;
  }

  private async fixMacOSElectronApp(extractDir: string): Promise<void> {
    try {
      const electronAppPath = path.join(extractDir, "Electron.app");

      if (fs.existsSync(electronAppPath)) {
        // Fix permissions on key executable files
        const filesToFix = [
          "Contents/MacOS/Electron",
          "Contents/Frameworks/Electron Framework.framework/Electron Framework",
          "Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper",
          "Contents/Frameworks/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU)",
          "Contents/Frameworks/Electron Helper (Plugin).app/Contents/MacOS/Electron Helper (Plugin)",
          "Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer)"
        ];

        for (const file of filesToFix) {
          const filePath = path.join(electronAppPath, file);
          if (fs.existsSync(filePath)) {
            try {
              await fs.promises.chmod(filePath, 0o755);
              this.logger.debug(`Fixed permissions for: ${filePath}`);
            } catch (error) {
              this.logger.warn(`Could not fix permissions for ${filePath}: ${error}`);
            }
          }
        }

        // Remove quarantine attribute
        await this.runCommand(`xattr -rd com.apple.quarantine "${electronAppPath}" 2>/dev/null || true`);
        this.logger.info("Applied macOS Electron.app fixes");
      }
    } catch (error) {
      this.logger.warn(`Could not apply macOS Electron.app fixes: ${error}`);
    }
  }
}
