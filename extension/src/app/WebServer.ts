import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "./services/Logger";
import { ShaderStudioStatusBar } from "./ShaderStudioStatusBar";
import { getWebSocketPortFromConfig, injectPortIntoHtml } from "@shader-studio/utils";

export class WebServer {
  private logger!: Logger;
  private isServerRunning = false;
  private httpServer: http.Server | null = null;
  private statusBar: ShaderStudioStatusBar;

  constructor(
    private context: vscode.ExtensionContext,
    private devMode: boolean = false,
  ) {
    this.logger = Logger.getInstance();
    this.statusBar = new ShaderStudioStatusBar(context);
  }

  private getWebServerPort(): number {
    const currentConfig = vscode.workspace.getConfiguration("shader-studio");
    return currentConfig.get<number>("webServerPort") || 3000;
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

    const uiDistPath = this.devMode
      ? vscode.Uri.joinPath(this.context.extensionUri, "..", "ui", "dist").fsPath
      : vscode.Uri.joinPath(this.context.extensionUri, "ui-dist").fsPath;

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

        // Inject WebSocket port for index.html
        if (path.basename(filePath) === "index.html") {
          const currentConfig = vscode.workspace.getConfiguration("shader-studio");
          const webSocketPort = getWebSocketPortFromConfig(currentConfig);
          let htmlContent = data.toString();
          htmlContent = injectPortIntoHtml(htmlContent, webSocketPort);
          data = Buffer.from(htmlContent);
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
    console.log(`WebServer: Received request for: ${req.url}`);
    
    if (!req.url) {
      console.log('WebServer: No URL in request');
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    if (!req.url.startsWith("/textures/")) {
      console.log(`WebServer: Invalid texture URL: ${req.url}`);
      res.writeHead(400);
      res.end("Invalid texture URL");
      return;
    }

    const encodedPath = req.url.replace("/textures/", "");
    const texturePath = decodeURIComponent(encodedPath);
    
    console.log(`WebServer: Encoded path: ${encodedPath}`);
    console.log(`WebServer: Decoded path: ${texturePath}`);

    if (!fs.existsSync(texturePath)) {
      console.log(`WebServer: File not found: ${texturePath}`);
      res.writeHead(404);
      res.end("Texture not found");
      return;
    }

    const stats = fs.statSync(texturePath);
    if (!stats.isFile()) {
      console.log(`WebServer: Not a file: ${texturePath}`);
      res.writeHead(403);
      res.end("Invalid texture path");
      return;
    }

    console.log(`WebServer: Serving file: ${texturePath} (${stats.size} bytes)`);

    // Handle range requests for video files
    const range = req.headers.range;
    if (range && this.isVideoFile(texturePath)) {
      console.log(`WebServer: Video range request: ${range}`);
      this.handleVideoRangeRequest(req, res, texturePath, stats);
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
        case ".webm":
          contentType = "video/webm";
          break;
        case ".mp4":
          contentType = "video/mp4";
          break;
        case ".mov":
          contentType = "video/quicktime";
          break;
        case ".avi":
          contentType = "video/x-msvideo";
          break;
        default:
          contentType = "application/octet-stream";
      }

      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Range",
        "Accept-Ranges": "bytes",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cross-Origin-Embedder-Policy": "unsafe-none",
        "Cross-Origin-Opener-Policy": "cross-origin",
      });
      res.end(data);
    });
  }

  private isVideoFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.webm', '.mp4', '.mov', '.avi'].includes(ext);
  }

  private handleVideoRangeRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string,
    stats: fs.Stats
  ): void {
    const range = req.headers.range;
    console.log(`WebServer: Processing range request: ${range}`);
    
    if (!range) {
      console.log('WebServer: No range header, sending entire file');
      // No range header, send entire file
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
    const chunksize = (end - start) + 1;

    console.log(`WebServer: Range ${start}-${end}/${stats.size} (${chunksize} bytes)`);

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stats.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': this.getContentType(filePath),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
      'Cross-Origin-Opener-Policy': 'cross-origin',
    });

    console.log(`WebServer: Sending 206 response with headers:`, {
      'Content-Range': `bytes ${start}-${end}/${stats.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': this.getContentType(filePath),
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', (error) => {
      console.error(`WebServer: Stream error: ${error}`);
      res.end();
    });
    
    stream.on('end', () => {
      console.log(`WebServer: Stream completed for range ${start}-${end}`);
    });
    
    stream.pipe(res);
  }

  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case ".webm": return "video/webm";
      case ".mp4": return "video/mp4";
      case ".mov": return "video/quicktime";
      case ".avi": return "video/x-msvideo";
      default: return "application/octet-stream";
    }
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
