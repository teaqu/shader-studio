import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { ShaderProcessor } from "./ShaderProcessor";
import { Messenger } from "./communication/Messenger";
import { Logger } from "./services/Logger";
import { ShaderViewStatusBar } from "./ShaderViewStatusBar";

export class WebServer {
  private httpPort: number = 3000;
  private logger!: Logger;
  private isServerRunning = false;
  private httpServer: http.Server | null = null;
  private statusBar: ShaderViewStatusBar;

  constructor(
    private context: vscode.ExtensionContext,
    private messenger: Messenger,
    private shaderProcessor: ShaderProcessor,
  ) {
    this.logger = Logger.getInstance();
    this.statusBar = new ShaderViewStatusBar(context);
  }

  public startWebServer(): void {
    if (this.isServerRunning) {
      this.logger.info("Web server already running");
      return;
    }

    try {
      this.logger.info(`Starting HTTP server on port ${this.httpPort}`);

      this.startHttpServer();

      this.isServerRunning = true;
      this.statusBar.updateServerStatus(true, this.httpPort);
      this.logger.info(`HTTP server started on port ${this.httpPort}`);
    } catch (error) {
      this.logger.error(`Failed to start web server: ${error}`);
      this.isServerRunning = false;
      throw error;
    }
  }

  private startHttpServer(): void {
    if (this.httpServer) {
      this.logger.warn("HTTP server already exists, closing previous instance");
      this.httpServer.close();
    }

    const workspaceUri = vscode.Uri.joinPath(this.context.extensionUri, '..');
    const uiDistPath = vscode.Uri.joinPath(workspaceUri, 'ui', 'dist').fsPath;

    this.httpServer = http.createServer((req, res) => {
      let filePath = path.join(uiDistPath, req.url === '/' ? 'index.html' : req.url || '');

      const resolvedPath = path.resolve(filePath);
      const resolvedDistPath = path.resolve(uiDistPath);
      if (!resolvedPath.startsWith(resolvedDistPath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('File not found');
          return;
        }

        const ext = path.extname(filePath);
        let contentType = 'text/html';
        switch (ext) {
          case '.js':
            contentType = 'application/javascript';
            break;
          case '.css':
            contentType = 'text/css';
            break;
          case '.json':
            contentType = 'application/json';
            break;
          case '.png':
            contentType = 'image/png';
            break;
          case '.jpg':
          case '.jpeg':
            contentType = 'image/jpeg';
            break;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    this.httpServer.listen(this.httpPort, () => {
      this.logger.info(`HTTP server listening on port ${this.httpPort}`);
    });

    this.httpServer.on('error', (error) => {
      this.logger.error(`HTTP server error: ${error}`);
    });
  }

  public stopWebServer(): void {
    if (this.isServerRunning) {
      if (this.httpServer) {
        this.httpServer.close();
        this.httpServer = null;
      }
      this.isServerRunning = false;
      this.statusBar.updateServerStatus(false);
      this.logger.info("WebSocket and HTTP servers stopped");
    }
  }

  public sendShaderToWebServer(editor: vscode.TextEditor, isLocked: boolean = false): void {
    if (this.isServerRunning) {
      this.shaderProcessor.sendShaderToWebview(editor, isLocked);
      this.logger.info("Shader sent to web server clients");
    } else {
      this.logger.warn("Web server not running");
    }
  }

  public isRunning(): boolean {
    return this.isServerRunning;
  }

  public getHttpUrl(): string {
    return `http://localhost:${this.httpPort}`;
  }

  public getStatusBar(): ShaderViewStatusBar {
    return this.statusBar;
  }

  public async showWebServerMenu(): Promise<void> {
    const items = [
      {
        label: '$(globe) Open in Browser',
        description: `${this.getHttpUrl()}`,
        action: 'open'
      },
      {
        label: '$(copy) Copy URL',
        description: 'Copy server URL to clipboard',
        action: 'copy'
      },
      {
        label: '$(stop-circle) Stop Server',
        description: 'Stop the Shader View web server',
        action: 'stop'
      }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Shader View Web Server Options',
      title: `Web Server Running on ${this.getHttpUrl()}`
    });

    if (selected) {
      switch (selected.action) {
        case 'open':
          await vscode.env.openExternal(vscode.Uri.parse(this.getHttpUrl()));
          break;
        case 'copy':
          await vscode.env.clipboard.writeText(this.getHttpUrl());
          vscode.window.showInformationMessage('Server URL copied to clipboard');
          break;
        case 'stop':
          this.stopWebServer();
          vscode.window.showInformationMessage('Shader View web server stopped');
          break;
      }
    }
  }
}
