import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "./services/Logger";
import { ShaderStudioStatusBar } from "./ShaderStudioStatusBar";
import { Messenger } from "./transport/Messenger";
import { injectPortIntoHtml } from "@shader-studio/utils";

/**
 * Resolves a URL-encoded texture path only when it names a regular file below
 * one of the roots explicitly trusted by the extension.  Real paths are used
 * for both sides of the comparison so a symlink cannot escape a workspace.
 */
export function resolveSafeTexturePath(encodedPath: string, allowedRoots: readonly string[]): string | undefined {
  return resolveAuthorizedTextureFile(encodedPath, allowedRoots)?.path;
}

/**
 * Resolves a bundled UI asset beneath the canonical distribution root. The
 * extension installation itself may be reached through a symlink (as it is in
 * the installed-VSIX test host), so both sides of the containment check must
 * use their real paths.
 */
export function resolveSafeUiAsset(requestPath: string, uiDistPath: string): string | undefined {
  return resolveAuthorizedUiAsset(requestPath, uiDistPath)?.path;
}

export function getTextureCorsHeaders(origin: string | undefined, httpPort: number): Record<string, string> {
  if (!origin) {
    return { "Cross-Origin-Resource-Policy": "same-origin" };
  }

  try {
    const parsedOrigin = new URL(origin);
    const hasUnexpectedParts = parsedOrigin.username
      || parsedOrigin.password
      || (parsedOrigin.pathname !== "" && parsedOrigin.pathname !== "/")
      || parsedOrigin.search
      || parsedOrigin.hash;
    const isServerLoopback = parsedOrigin.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname)
      && parsedOrigin.port === String(httpPort);
    const isVsCodeWebview = parsedOrigin.protocol === "vscode-webview:" && Boolean(parsedOrigin.hostname);
    if (!hasUnexpectedParts && (isServerLoopback || isVsCodeWebview)) {
      return {
        "Access-Control-Allow-Origin": origin,
        "Cross-Origin-Resource-Policy": "cross-origin",
        Vary: "Origin",
      };
    }
  } catch {
    // Invalid and untrusted origins receive no CORS permission.
  }

  return { "Cross-Origin-Resource-Policy": "same-origin" };
}

const shaderDocumentPattern = /\.(?:frag|vert|comp|glsl|slang|wgsl|sha\.json)$/i;

export function collectTextureRoots(
  workspaceFolders: readonly Pick<vscode.WorkspaceFolder, "uri">[] | undefined,
  textDocuments: readonly Pick<vscode.TextDocument, "uri">[],
): string[] {
  const roots = new Set(workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []);
  for (const document of textDocuments) {
    if (document.uri.scheme === "file" && shaderDocumentPattern.test(document.uri.fsPath)) {
      roots.add(path.dirname(document.uri.fsPath));
    }
  }
  return [...roots];
}

interface AuthorizedFile {
  path: string;
  identity: Pick<fs.Stats, "dev" | "ino">;
}

function resolveAuthorizedTextureFile(encodedPath: string, allowedRoots: readonly string[]): AuthorizedFile | undefined {
  const decodedPath = decodePath(encodedPath);
  if (!decodedPath || !path.isAbsolute(decodedPath)) {
    return undefined;
  }

  for (const root of allowedRoots) {
    const requestedRelativePath = path.relative(root, decodedPath);
    if (!isSafeRelativePath(requestedRelativePath)) {
      continue;
    }

    const authorizedFile = findRegularFileBelowRoot(root, requestedRelativePath);
    if (authorizedFile) {
      return authorizedFile;
    }
  }

  return undefined;
}

function resolveAuthorizedUiAsset(requestPath: string, uiDistPath: string): AuthorizedFile | undefined {
  const requestedAsset = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const decodedAsset = decodePath(requestedAsset);
  if (!decodedAsset || !isSafeRelativePath(decodedAsset)) {
    return undefined;
  }

  return findRegularFileBelowRoot(uiDistPath, decodedAsset);
}

/**
 * Finds a requested file by walking a trusted root. Request data is used only
 * for comparison, so filesystem operations never receive a path derived from
 * the HTTP request. Canonical paths keep symlink targets inside the root.
 */
function findRegularFileBelowRoot(root: string, requestedRelativePath: string): AuthorizedFile | undefined {
  try {
    const canonicalRoot = fs.realpathSync(root);
    const expectedParts = path.normalize(requestedRelativePath).split(path.sep);
    return findRegularFileInDirectory(canonicalRoot, canonicalRoot, expectedParts, 0, new Set());
  } catch {
    return undefined;
  }
}

function findRegularFileInDirectory(
  canonicalRoot: string,
  directory: string,
  expectedParts: readonly string[],
  partIndex: number,
  ancestors: ReadonlySet<string>,
): AuthorizedFile | undefined {
  const canonicalDirectory = fs.realpathSync(directory);
  if (!isWithinRoot(canonicalDirectory, canonicalRoot) || ancestors.has(canonicalDirectory)) {
    return undefined;
  }

  const nextAncestors = new Set(ancestors).add(canonicalDirectory);
  for (const entry of fs.readdirSync(canonicalDirectory, { withFileTypes: true })) {
    if (entry.name !== expectedParts[partIndex]) {
      continue;
    }

    const candidatePath = path.join(canonicalDirectory, entry.name);
    const canonicalPath = fs.realpathSync(candidatePath);
    if (!isWithinRoot(canonicalPath, canonicalRoot)) {
      continue;
    }

    const stats = fs.lstatSync(canonicalPath);
    if (partIndex === expectedParts.length - 1 && stats.isFile()) {
      return { path: canonicalPath, identity: stats };
    }
    if (partIndex < expectedParts.length - 1 && stats.isDirectory()) {
      const authorizedFile = findRegularFileInDirectory(
        canonicalRoot,
        canonicalPath,
        expectedParts,
        partIndex + 1,
        nextAncestors,
      );
      if (authorizedFile) {
        return authorizedFile;
      }
    }
  }

  return undefined;
}

function decodePath(encodedPath: string): string | undefined {
  let decodedPath = encodedPath;
  for (let index = 0; index < 4; index += 1) {
    try {
      const next = decodeURIComponent(decodedPath);
      if (next === decodedPath) {
        break;
      }
      decodedPath = next;
    } catch {
      // A percent sign in a valid filename becomes literal after its first
      // decode; only the original request must itself be well-formed.
      return index === 0 ? undefined : decodedPath;
    }
  }

  if (decodedPath.split(/[\\/]+/).includes("..")) {
    return undefined;
  }
  return decodedPath;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isSafeRelativePath(candidate: string): boolean {
  return candidate !== "" && !path.isAbsolute(candidate) && !candidate.split(/[\\/]+/).includes("..");
}

export function parseRange(range: string, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || !size || (!match[1] && !match[2])) {
    return undefined;
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return undefined;
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return undefined;
  }
  return { start, end: Math.min(end, size - 1) };
}

export function openRegularFile(
  filePath: string,
  expectedStats: Pick<fs.Stats, "dev" | "ino">,
  callback: (error: NodeJS.ErrnoException | null, fd?: number, stats?: fs.Stats) => void,
): void {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  fs.open(filePath, fs.constants.O_RDONLY | noFollow, (openError, fd) => {
    if (openError) {
      callback(openError);
      return;
    }
    fs.fstat(fd, (statError, stats) => {
      if (statError || !stats.isFile() || stats.dev !== expectedStats.dev || stats.ino !== expectedStats.ino) {
        fs.close(fd, () => callback(statError ?? Object.assign(new Error("Not a regular file"), { code: "EISDIR" })));
        return;
      }
      callback(null, fd, stats);
    });
  });
}

export class WebServer {
  private logger!: Logger;
  private isServerRunning = false;
  private httpServer: http.Server | null = null;
  private statusBar: ShaderStudioStatusBar;
  private messenger: Messenger | null = null;
  private webSocketPort: number = 0;

  constructor(
    private context: vscode.ExtensionContext,
    private devMode: boolean = false,
  ) {
    this.logger = Logger.getInstance();
    this.statusBar = new ShaderStudioStatusBar(context);
  }

  public setMessenger(messenger: Messenger): void {
    this.messenger = messenger;
  }

  public setWebSocketPort(port: number): void {
    this.webSocketPort = port;
  }

  private broadcastServerState(): void {
    if (this.messenger) {
      this.messenger.send({
        type: 'webServerState',
        payload: { isRunning: this.isServerRunning }
      });
    }
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
      this.broadcastServerState();
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
      if (req.method === "OPTIONS") {
        const requestPath = this.getRequestPath(req.url);
        const corsHeaders = requestPath.startsWith("/textures/")
          ? getTextureCorsHeaders(req.headers.origin, httpPort)
          : {};
        res.writeHead(204, {
          ...corsHeaders,
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        });
        res.end();
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD, OPTIONS" });
        res.end();
        return;
      }

      const requestPath = this.getRequestPath(req.url);
      if (requestPath.startsWith("/textures/")) {
        this.handleTextureRequest(req, res);
        return;
      }

      const authorizedFile = resolveAuthorizedUiAsset(requestPath, uiDistPath);
      if (!authorizedFile) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      openRegularFile(authorizedFile.path, authorizedFile.identity, (openError, fd) => {
        if (openError || fd === undefined) {
          res.writeHead(404);
          res.end("File not found");
          return;
        }

        fs.readFile(fd, (err, data) => {
          fs.close(fd, () => undefined);
          if (err) {
            res.writeHead(404);
            res.end("File not found");
            return;
          }

          // Inject WebSocket port for index.html
          if (path.basename(authorizedFile.path) === "index.html") {
            let htmlContent = data.toString();
            htmlContent = injectPortIntoHtml(htmlContent, this.webSocketPort);
            data = Buffer.from(htmlContent);
          }

          const ext = path.extname(authorizedFile.path);
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
            case ".mp4":
              contentType = "video/mp4";
              break;
            case ".ttf":
              contentType = "font/ttf";
              break;
            case ".woff":
              contentType = "font/woff";
              break;
            case ".woff2":
              contentType = "font/woff2";
              break;
            case ".svg":
              contentType = "image/svg+xml";
              break;
            case ".wasm":
              contentType = "application/wasm";
              break;
          }

          res.writeHead(200, { "Content-Type": contentType });
          if (req.method === "HEAD") {
            res.end();
          } else {
            res.end(data);
          }
        });
      });
    });

    this.httpServer.listen(httpPort, () => {
      this.logger.info(`HTTP server listening on port ${httpPort}`);
    });

    this.httpServer.on("error", (error) => {
      this.logger.error(`HTTP server error: ${error}`);
    });
  }

  private getRequestPath(url: string | undefined): string {
    if (!url) {
      return "/";
    }

    try {
      return new URL(url, "http://localhost").pathname;
    } catch {
      return url.split("?")[0] || "/";
    }
  }

  private handleTextureRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    Logger.trace(`WebServer: Received request for: ${req.url}`);
    for (const [name, value] of Object.entries(
      getTextureCorsHeaders(req.headers.origin, this.getWebServerPort()),
    )) {
      res.setHeader(name, value);
    }
    
    if (!req.url) {
      Logger.trace('WebServer: No URL in request');
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    const requestPath = this.getRequestPath(req.url);
    if (!requestPath.startsWith("/textures/")) {
      Logger.trace(`WebServer: Invalid texture URL: ${req.url}`);
      res.writeHead(400);
      res.end("Invalid texture URL");
      return;
    }

    const encodedPath = requestPath.slice("/textures/".length);
    const authorizedFile = resolveAuthorizedTextureFile(encodedPath, this.getTextureRoots());
    const texturePath = authorizedFile?.path;
    
    Logger.trace(`WebServer: Encoded path: ${encodedPath}`);
    Logger.trace(`WebServer: Decoded path: ${texturePath}`);

    if (!authorizedFile || !texturePath) {
      Logger.trace("WebServer: Rejected texture path outside allowed workspace roots");
      res.writeHead(403);
      res.end("Invalid texture path");
      return;
    }

    openRegularFile(texturePath, authorizedFile.identity, (openError, fd, stats) => {
      if (openError || fd === undefined || !stats) {
        res.writeHead(404);
        res.end("Texture file not found");
        return;
      }

      Logger.trace(`WebServer: Serving file: ${texturePath} (${stats.size} bytes)`);

      if (req.headers.range) {
        this.handleRangeRequest(req, res, texturePath, fd, stats);
        return;
      }

      fs.readFile(fd, (err, data) => {
        fs.close(fd, () => undefined);
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
          case ".svg":
            contentType = "image/svg+xml";
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
          "Accept-Ranges": "bytes",
          ...getTextureCorsHeaders(req.headers.origin, this.getWebServerPort()),
        });
        if (req.method === "HEAD") {
          res.end();
        } else {
          res.end(data);
        }
      });
    });
  }

  private getTextureRoots(): readonly string[] {
    return collectTextureRoots(vscode.workspace.workspaceFolders, vscode.workspace.textDocuments);
  }

  private handleRangeRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string,
    fd: number,
    stats: fs.Stats
  ): void {
    const range = req.headers.range;
    Logger.trace(`WebServer: Processing range request: ${range}`);
    
    if (!range) {
      Logger.trace('WebServer: No range header, sending entire file');
      // No range header, send entire file
      fs.createReadStream(filePath, { fd, autoClose: true }).pipe(res);
      return;
    }

    const parsedRange = parseRange(range, stats.size);
    if (!parsedRange) {
      fs.close(fd, () => undefined);
      res.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
      res.end();
      return;
    }
    const { start, end } = parsedRange;
    const chunksize = (end - start) + 1;

    Logger.trace(`WebServer: Range ${start}-${end}/${stats.size} (${chunksize} bytes)`);

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stats.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': this.getContentType(filePath),
      ...getTextureCorsHeaders(req.headers.origin, this.getWebServerPort()),
    });

    Logger.trace(`WebServer: 206 response bytes ${start}-${end}/${stats.size}, `
      + `${chunksize} bytes, ${this.getContentType(filePath)}`);

    if (req.method === "HEAD") {
      fs.close(fd, () => undefined);
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath, { fd, autoClose: true, start, end });
    stream.on('error', (error) => {
      console.error(`WebServer: Stream error: ${error}`);
      res.end();
    });
    
    stream.on('end', () => {
      Logger.trace(`WebServer: Stream completed for range ${start}-${end}`);
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
      this.broadcastServerState();
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
