import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as child_process from "child_process";
import { Logger } from "./services/Logger";

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

      if (
        isDevelopment &&
        this.context.extensionMode === vscode.ExtensionMode.Development
      ) {
        this.logger.info("Development mode detected - using npx electron");
        await this.launchWithNpx(electronDir, launcherScript);
      } else {
        this.logger.info(
          "Using downloaded Electron (installed extension or non-dev mode)",
        );
        await this.launchWithDownloadedElectron(electronDir, launcherScript);
      }
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

    // Fallback to workspace electron directory (development scenario)
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
      name: `Shader View Dev ${Date.now()}`,
      cwd: electronDir,
      hideFromUser: true,
    });

    const command = `npx electron "${launcherScript}"`;
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

    // Launch in terminal
    const terminal = vscode.window.createTerminal({
      name: `Shader View Electron ${Date.now()}`,
      cwd: electronDir,
      hideFromUser: true,
    });

    const command = `& "${electronPath}" "${launcherScript}"`;
    terminal.sendText(command);

    this.logger.info(
      `Opened VS Code terminal to launch downloaded Electron with command: ${command}`,
    );
    vscode.window.showInformationMessage("Launched Shader View in Electron");
  }

  private async getOrDownloadElectron(): Promise<string> {
    // Use cached download if available
    if (ElectronLauncher.downloadedElectronPath) {
      this.logger.info(
        `Using cached Electron executable: ${ElectronLauncher.downloadedElectronPath}`,
      );
      return ElectronLauncher.downloadedElectronPath;
    }

    // Check if download is already in progress
    if (ElectronLauncher.downloadInProgress) {
      this.logger.info("Download already in progress, waiting...");
      return await ElectronLauncher.downloadInProgress;
    }

    // Start new download
    const electronVersion = await this.getElectronVersion();
    ElectronLauncher.downloadInProgress = this.downloadElectron(
      electronVersion,
    );
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
      throw new Error(
        `Launcher script not found at ${launcherScript}: ${error}`,
      );
    }
  }

  private async getElectronVersion(): Promise<string> {
    // Try bundled electron app first
    const extensionDir = this.context.extensionUri.fsPath;
    const electronAppDir = path.join(extensionDir, "electron-app");
    const bundledVersion = this.readElectronVersionFromPackageJson(
      path.join(electronAppDir, "package.json"),
    );
    if (bundledVersion) return bundledVersion;

    // Fallback to workspace electron directory
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      const workspaceVersion = this.readElectronVersionFromPackageJson(
        path.join(workspaceRoot, "electron", "package.json"),
      );
      if (workspaceVersion) return workspaceVersion;
    }

    // Default fallback
    this.logger.info("Using default Electron version 32.0.0");
    return "32.0.0";
  }

  private readElectronVersionFromPackageJson(
    packageJsonPath: string,
  ): string | null {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const electronVersion = packageJson.devDependencies?.electron ||
        packageJson.dependencies?.electron;
      if (electronVersion) {
        // Remove ^ or ~ prefix
        return electronVersion.replace(/^[\^~]/, "");
      }
    } catch (error) {
      this.logger.debug(
        `Could not read electron version from ${packageJsonPath}: ${error}`,
      );
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

      await this.logDirectoryContentsIfPossible(
        downloadPath,
        "Download directory",
      );
      return this.findElectronExecutable(downloadPath);
    } catch (error) {
      this.logger.error(`Failed to download Electron: ${error}`);
      throw new Error(`Failed to download Electron: ${error}`);
    }
  }

  private async handleZipExtraction(downloadPath: string): Promise<string> {
    const extractDir = downloadPath.replace(".zip", "-extracted");
    this.logger.info(
      `Download path is a zip file, checking extraction at: ${extractDir}`,
    );

    // Check if already extracted and valid
    if (fs.existsSync(extractDir)) {
      this.logger.info(
        `Extraction directory already exists, checking for executable`,
      );
      try {
        const executablePath = await this.findElectronExecutable(extractDir);
        this.logger.info(
          `Using cached extracted Electron at: ${executablePath}`,
        );
        return executablePath;
      } catch (error) {
        this.logger.warn(`Cached extraction invalid, re-extracting: ${error}`);
        await this.removeDirectorySafely(extractDir);
      }
    }

    // Extract the zip file
    this.logger.info(`Extracting to: ${extractDir}`);
    await this.extractZip(downloadPath, extractDir);
    await this.logDirectoryContentsIfPossible(
      extractDir,
      "Extracted directory",
    );
    return this.findElectronExecutable(extractDir);
  }

  private async removeDirectorySafely(dir: string): Promise<void> {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch (removeError) {
      this.logger.warn(`Could not remove directory ${dir}: ${removeError}`);
    }
  }

  private async logDirectoryContentsIfPossible(
    dir: string,
    label: string,
  ): Promise<void> {
    try {
      const contents = await fs.promises.readdir(dir);
      this.logger.info(`${label} contents: ${contents.join(", ")}`);
    } catch (error) {
      this.logger.warn(`Could not list ${label.toLowerCase()}: ${error}`);
    }
  }

  private async extractZip(zipPath: string, extractDir: string): Promise<void> {
    const yauzl = await import("yauzl");

    return new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          reject(err);
          return;
        }

        if (!zipfile) {
          reject(new Error("Failed to open zip file"));
          return;
        }

        // Create extract directory
        if (!fs.existsSync(extractDir)) {
          fs.mkdirSync(extractDir, { recursive: true });
        }

        zipfile.readEntry();

        zipfile.on("entry", (entry) => {
          const entryPath = path.join(extractDir, entry.fileName);

          if (/\/$/.test(entry.fileName)) {
            fs.mkdirSync(entryPath, { recursive: true });
            zipfile.readEntry();
          } else {
            fs.mkdirSync(path.dirname(entryPath), { recursive: true });

            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                reject(err);
                return;
              }

              if (!readStream) {
                reject(new Error("Failed to create read stream"));
                return;
              }

              const writeStream = fs.createWriteStream(entryPath);
              readStream.pipe(writeStream);

              writeStream.on("close", () => {
                if (
                  process.platform !== "win32" &&
                  entry.fileName.includes("electron")
                ) {
                  try {
                    fs.chmodSync(entryPath, 0o755);
                  } catch (error) {
                    this.logger.warn(
                      `Could not set executable permissions on ${entryPath}: ${error}`,
                    );
                  }
                }
                zipfile.readEntry();
              });

              writeStream.on("error", reject);
            });
          }
        });

        zipfile.on("end", () => {
          this.logger.info("Zip extraction completed");
          resolve();
        });

        zipfile.on("error", reject);
      });
    });
  }

  private async findElectronExecutable(downloadPath: string): Promise<string> {
    const platform = process.platform;
    const executablePath = this.getExpectedExecutablePath(
      downloadPath,
      platform,
    );

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

  private getExpectedExecutablePath(
    downloadPath: string,
    platform: string,
  ): string {
    if (platform === "win32") {
      return path.join(downloadPath, "electron.exe");
    } else if (platform === "darwin") {
      return path.join(
        downloadPath,
        "Electron.app",
        "Contents",
        "MacOS",
        "Electron",
      );
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

  private async searchForExecutable(
    dir: string,
    platform: string,
  ): Promise<string | null> {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isFile()) {
          if (
            (platform === "win32" && entry.name === "electron.exe") ||
            (platform !== "win32" && entry.name === "electron")
          ) {
            return fullPath;
          }
        } else if (entry.isDirectory()) {
          const found = await this.searchForExecutable(fullPath, platform);
          if (found) return found;
        }
      }
    } catch (error) {
      this.logger.debug(`Error searching in ${dir}: ${error}`);
    }
    return null;
  }
}
