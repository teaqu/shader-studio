import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "./services/Logger";
import { ShaderStudioStatusBar } from "./ShaderStudioStatusBar";

export class WebServer {
  private logger!: Logger;
  private isServerRunning = false;
  private httpServer: http.Server | null = null;
  private statusBar: ShaderStudioStatusBar;

  constructor(
    private context: vscode.ExtensionContext,
  ) {
    this.logger = Logger.getInstance();
    this.statusBar = new ShaderStudioStatusBar(context);
  }

  private getWebServerPort(): number {
    const config = vscode.workspace.getConfiguration("shader-studio");
    return config.get<number>("webServerPort") || 3000;
  }

  public startWebServer(): void {
    if (this.isServerRunning) {
      this.logger.info("Web server already running");
      return;
    }

    const httpPort = this.getWebServerPort();

    try {
      this.logger.info(`Starting HTTP server on port ${httpPort}`);

      this.startHttpServer(httpPort);

      this.isServerRunning = true;
      this.statusBar.updateServerStatus(true, httpPort);
      this.logger.info(`HTTP server started on port ${httpPort}`);
    } catch (error) {
      this.logger.error(`Failed to start web server: ${error}`);
      this.isServerRunning = false;
      throw error;
    }
  }

  private startHttpServer(httpPort: number): void {
    if (this.httpServer) {
      this.logger.warn("HTTP server already exists, closing previous instance");
      this.httpServer.close();
    }

    const uiDistPath =
      vscode.Uri.joinPath(this.context.extensionUri, "ui-dist").fsPath;

    this.httpServer = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.url?.startsWith("/textures/")) {
        this.handleTextureRequest(req, res);
        return;
      }

      let filePath = path.join(
        uiDistPath,
        req.url === "/" ? "index.html" : req.url || "",
      );

      const resolvedPath = path.resolve(filePath);
      const resolvedDistPath = path.resolve(uiDistPath);
      if (!resolvedPath.startsWith(resolvedDistPath)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("File not found");
          return;
        }

        const ext = path.extname(filePath);
        let contentType = "text/html";
        switch (ext) {
          case ".js":
            contentType = "application/javascript";
            break;
          case ".css":
            contentType = "text/css";
            break;
          case ".json":
            contentType = "application/json";
            break;
          case ".png":
            contentType = "image/png";
            break;
          case ".jpg":
          case ".jpeg":
            contentType = "image/jpeg";
            break;
        }

        res.writeHead(200, { "Content-Type": contentType });
        res.end(data);
      });
    });

    this.httpServer.listen(httpPort, () => {
      this.logger.info(`HTTP server listening on port ${httpPort}`);
    });

    this.httpServer.on("error", (error) => {
      this.logger.error(`HTTP server error: ${error}`);
    });
  }

  private handleTextureRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    if (!req.url) {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    const encodedPath = req.url.replace("/textures/", "");
    const texturePath = decodeURIComponent(encodedPath);

    if (!fs.existsSync(texturePath)) {
      res.writeHead(404);
      res.end("Texture not found");
      return;
    }

    const stats = fs.statSync(texturePath);
    if (!stats.isFile()) {
      res.writeHead(403);
      res.end("Invalid texture path");
      return;
    }

    fs.readFile(texturePath, (err, data) => {
      if (err) {
        this.logger.error(`Failed to read texture file ${texturePath}: ${err}`);
        res.writeHead(404);
        res.end("Texture file not found");
        return;
      }

      const ext = path.extname(texturePath).toLowerCase();
      let contentType = "image/png";
      switch (ext) {
        case ".jpg":
        case ".jpeg":
          contentType = "image/jpeg";
          break;
        case ".png":
          contentType = "image/png";
          break;
        case ".gif":
          contentType = "image/gif";
          break;
        case ".bmp":
          contentType = "image/bmp";
          break;
        default:
          contentType = "application/octet-stream";
      }

      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      });
      res.end(data);
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

  public isRunning(): boolean {
    return this.isServerRunning;
  }

  public getHttpUrl(): string {
    const httpPort = this.getWebServerPort();
    return `http://localhost:${httpPort}`;
  }

  public getStatusBar(): ShaderStudioStatusBar {
    return this.statusBar;
  }

  public async showWebServerMenu(): Promise<void> {
    const items = [
      {
        label: "$(globe) Open in Browser",
        description: `${this.getHttpUrl()}`,
        action: "open",
      },
      {
        label: "$(copy) Copy URL",
        description: "Copy server URL to clipboard",
        action: "copy",
      },
      {
        label: "$(stop-circle) Stop Server",
        description: "Stop the Shader Studio web server",
        action: "stop",
      },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Shader Studio Web Server Options",
      title: `Web Server Running on ${this.getHttpUrl()}`,
    });

    if (selected) {
      switch (selected.action) {
        case "open":
          await vscode.env.openExternal(vscode.Uri.parse(this.getHttpUrl()));
          break;
        case "copy":
          await vscode.env.clipboard.writeText(this.getHttpUrl());
          vscode.window.showInformationMessage(
            "Server URL copied to clipboard",
          );
          break;
        case "stop":
          this.stopWebServer();
          vscode.window.showInformationMessage(
            "Shader Studio web server stopped",
          );
          break;
      }
    }
  }
}
