import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { GlslFileTracker } from "./GlslFileTracker";
import { Messenger } from "./transport/Messenger";

export class ConfigGenerator {
  private logger: Logger;

  constructor(
    private glslFileTracker: GlslFileTracker,
    private messenger: Messenger,
    logger: Logger
  ) {
    this.logger = logger;
  }

  public async generateConfig(uri?: vscode.Uri, showConfirmation: boolean = false): Promise<void> {
    try {
      let glslFilePath: string;
      
      if (uri) {
        // URI was provided (e.g., from shader browser or UI)
        glslFilePath = uri.fsPath;
      } else {
        glslFilePath = await this.resolveGlslFilePath();
      }

      // Show confirmation dialog if requested (e.g., when called from UI)
      if (showConfirmation) {
        const fileName = require('path').basename(glslFilePath, '.glsl');
        
        // Show confirmation for creating new config
        const confirm = await vscode.window.showInformationMessage(
          `Generate config file for ${fileName}.glsl?`,
          "Yes",
          "No"
        );
        if (confirm !== "Yes") {
          return;
        }
      }

      // Generate the config file
      await this.createConfigFile(glslFilePath);
    } catch (error) {
      this.logger.error(`Failed to generate config: ${error}`);
      vscode.window.showErrorMessage(`Failed to generate config: ${error}`);
    }
  }

  private async resolveGlslFilePath(): Promise<string> {
    const activeEditor = vscode.window.activeTextEditor;

    if (activeEditor && activeEditor.document.fileName.endsWith(".glsl")) {
      return activeEditor.document.fileName;
    }

    // No active GLSL editor, determine behavior based on preview state
    if (this.messenger.hasActiveClients()) {
      // Preview is active, try to use last viewed GLSL file
      const lastViewedFile = this.glslFileTracker.getLastViewedGlslFile();
      
      if (lastViewedFile && fs.existsSync(lastViewedFile)) {
        return lastViewedFile;
      }
    }

    // Either no preview or no valid last viewed file, show file dialog
    return await this.showFileDialog();
  }

  private async showFileDialog(): Promise<string> {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        "GLSL Files": ["glsl"],
      },
      title: "Select GLSL file to generate config for",
    });

    if (!fileUri || fileUri.length === 0) {
      throw new Error("User cancelled file selection");
    }

    return fileUri[0].fsPath;
  }

  private async createConfigFile(glslFilePath: string): Promise<void> {
    // Get the base name without extension
    const baseName = path.basename(glslFilePath, ".glsl");
    const dirName = path.dirname(glslFilePath);

    // Create the config file path
    const configFilePath = path.join(dirName, `${baseName}.sha.json`);

    // Check if config file already exists
    if (fs.existsSync(configFilePath)) {
      const overwrite = await vscode.window.showWarningMessage(
        `Config file ${baseName}.sha.json already exists. Overwrite?`,
        "Yes",
        "No",
      );
      if (overwrite !== "Yes") {
        return;
      }
    }

    // Create base config
    const relativeGlslPath = path.relative(dirName, glslFilePath).replace(
      /\\/g,
      "/",
    );
    const baseConfig = {
      version: "1.0",
      passes: {
        Image: {
          inputs: {},
        },
      },
    };

    // Write the config file
    fs.writeFileSync(configFilePath, JSON.stringify(baseConfig, null, 2));

    // Open the config file
    const configUri = vscode.Uri.file(configFilePath);
    await vscode.commands.executeCommand("vscode.open", configUri);

    vscode.window.showInformationMessage(
      `Generated config file: ${baseName}.sha.json`,
    );
  }
}
