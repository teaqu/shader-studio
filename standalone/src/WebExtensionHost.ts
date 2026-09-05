import type { ShaderConfig } from '@shader-studio/types';
import type { VirtualWorkspace } from './VirtualWorkspace';

type HostMessage = { type: string; [key: string]: unknown };
type MessageHandler = (message: HostMessage) => void;
const DEFAULT_SHADER_PATH = '/shaders/aurora.glsl';
const ACTIVE_SHADER_PATH = '/.shader-studio/active-shader';
const EXPLORER_STATE_PATH = '/.shader-studio/explorer-state.json';

const GLSL_STARTER_SHADER = `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord / iResolution.xy;

    // Time varying pixel color
    vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0, 2, 4));

    // Output to screen
    fragColor = vec4(col, 1.0);
}
`;

const SLANG_STARTER_SHADER = `float4 mainImage(float2 fragCoord)
{
    // Normalized pixel coordinates (from 0 to 1)
    float2 uv = fragCoord / iResolution.xy;

    // Time varying pixel color
    float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));

    // Output to screen
    return float4(col, 1.0);
}
`;

const LEGACY_GLSL_STARTER_SHADER = 'void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0, 0, 0, 1); }\n';
const LEGACY_SLANG_STARTER_SHADER = 'float4 mainImage(float2 fragCoord) { return float4(0, 0, 0, 1); }\n';

interface WebExtensionHostOptions {
  resolveDefaultAsset?: (path: string) => string | null;
  prompt?: (message: string, initialValue: string) => string | null;
  confirm?: (message: string) => boolean;
}

function configPathForShader(shaderPath: string): string {
  return shaderPath.replace(/\.(glsl|frag|slang)$/i, '.sha.json');
}

function shaderLanguage(path: string): 'glsl' | 'slang' {
  return path.toLowerCase().endsWith('.slang') ? 'slang' : 'glsl';
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function relativePath(path: string): string {
  return path.replace(/^\//, '');
}

export class WebExtensionHost {
  private readonly viewerHandlers = new Set<MessageHandler>();
  private readonly explorerHandlers = new Set<MessageHandler>();
  private activeShaderPath: string | null = null;
  private readonly resolveDefaultAsset: (path: string) => string | null;
  private readonly prompt: (message: string, initialValue: string) => string | null;
  private readonly confirm: (message: string) => boolean;

  constructor(
    private readonly workspace: VirtualWorkspace,
    options: WebExtensionHostOptions = {},
  ) {
    this.resolveDefaultAsset = options.resolveDefaultAsset ?? (() => null);
    this.prompt = options.prompt ?? ((message, initialValue) => window.prompt(message, initialValue));
    this.confirm = options.confirm ?? ((message) => window.confirm(message));
    const restoredPath = this.workspace.exists(ACTIVE_SHADER_PATH)
      ? this.workspace.readText(ACTIVE_SHADER_PATH)
      : null;
    this.activeShaderPath = restoredPath && this.workspace.exists(restoredPath)
      ? restoredPath
      : this.workspace.exists(DEFAULT_SHADER_PATH)
        ? DEFAULT_SHADER_PATH
        : this.shaderFiles()[0]?.path ?? null;
    this.migrateLegacyStarterShaders();
  }

  async clearWorkspace(): Promise<void> {
    await this.workspace.clear();
  }

  private migrateLegacyStarterShaders(): void {
    for (const shader of this.shaderFiles()) {
      const source = this.workspace.readText(shader.path);
      if (source === LEGACY_GLSL_STARTER_SHADER) {
        this.workspace.writeText(shader.path, GLSL_STARTER_SHADER);
      } else if (source === LEGACY_SLANG_STARTER_SHADER) {
        this.workspace.writeText(shader.path, SLANG_STARTER_SHADER);
      }
    }
  }

  onViewerMessage(handler: MessageHandler): () => void {
    this.viewerHandlers.add(handler);
    return () => this.viewerHandlers.delete(handler);
  }

  onExplorerMessage(handler: MessageHandler): () => void {
    this.explorerHandlers.add(handler);
    return () => this.explorerHandlers.delete(handler);
  }

  async start(): Promise<void> {
    if (this.activeShaderPath) {
      this.emitViewer(this.shaderSourceMessage(this.activeShaderPath));
    }
  }

  async handleViewerMessage(message: HostMessage): Promise<void> {
    const payload = message.payload && typeof message.payload === 'object'
      ? message.payload as Record<string, unknown>
      : {};

    switch (message.type) {
      case 'saveFile': {
        try {
          if (typeof payload.data !== 'string' || typeof payload.defaultName !== 'string' || !payload.defaultName.trim()) {
            throw new Error('Invalid export payload');
          }
          const bytes = Uint8Array.from(atob(payload.data), (character) => character.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
          const anchor = document.createElement('a');
          try {
            anchor.href = url;
            anchor.download = payload.defaultName;
            anchor.hidden = true;
            document.body.appendChild(anchor);
            anchor.click();
          } finally {
            anchor.remove();
            // Give the browser time to consume the URL before releasing it.
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
          this.emitViewer({ type: 'saveFileResult', payload: { success: true } });
        } catch (error) {
          this.emitViewer({ type: 'saveFileResult', payload: { success: false, error: String(error) } });
        }
        return;
      }
      case 'forkShader': {
        const sourcePath = payload.shaderPath;
        if (typeof sourcePath !== 'string' || !/\.(glsl|frag|slang)$/i.test(sourcePath) || !this.workspace.exists(sourcePath)) {
          return;
        }
        const extension = sourcePath.slice(sourcePath.lastIndexOf('.'));
        const rootPath = sourcePath.slice(0, -extension.length).replace(/\.\d+$/, '');
        let counter = 1;
        let destination = `${rootPath}.${counter}${extension}`;
        while (this.workspace.exists(destination) || this.workspace.exists(configPathForShader(destination))) {
          destination = `${rootPath}.${++counter}${extension}`;
        }
        this.workspace.writeText(destination, this.workspace.readText(sourcePath));
        const sourceConfig = configPathForShader(sourcePath);
        if (this.workspace.exists(sourceConfig)) {
          this.workspace.writeText(configPathForShader(destination), this.workspace.readText(sourceConfig));
        }
        this.setActiveShader(destination);
        this.sendShaderList();
        this.emitViewer(this.shaderSourceMessage(destination));
        return;
      }
      case 'languageServiceReady':
        this.emitViewer({
          type: 'languageServiceSettings',
          payload: { glslEnabled: true, slangEnabled: true, colorDecorators: true, trace: 'off' },
        });
        return;
      case 'extensionCommand':
        if (payload.command === 'newShader') {
          this.emitViewer({ type: 'showNewShaderModal' });
        }
        return;
      case 'createShader': {
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        const language = payload.language === 'slang' ? 'slang' : 'glsl';
        if (!name || /[/\\]/.test(name)) {
          return;
        }
        const extension = language === 'slang' ? '.slang' : '.glsl';
        const requestedName = name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`;
        const path = `/shaders/${requestedName}`;
        if (this.workspace.exists(path)) {
          return;
        }
        const source = language === 'slang' ? SLANG_STARTER_SHADER : GLSL_STARTER_SHADER;
        this.workspace.writeText(path, source);
        this.workspace.writeText(configPathForShader(path), JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } }, null, 2));
        this.setActiveShader(path);
        this.sendShaderList();
        this.emitViewer(this.shaderSourceMessage(path));
        return;
      }
      case 'createFile': {
        const shaderPath = typeof payload.shaderPath === 'string' ? payload.shaderPath : this.activeShaderPath;
        if (!shaderPath || typeof payload.suggestedPath !== 'string' || typeof payload.fileType !== 'string') {
          return;
        }
        const templates: Record<string, string> = {
          'glsl-buffer': GLSL_STARTER_SHADER,
          glsl: GLSL_STARTER_SHADER,
          'slang-buffer': SLANG_STARTER_SHADER,
          'glsl-common': '// Common functions shared across all passes\n',
          'slang-common': '// Common functions shared across all passes\n',
          'glsl-vertex': 'void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv) {\n}\n',
          'slang-vertex': 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) {\n}\n',
          'slang-compute': '[shader("compute")]\n[numthreads(8, 8, 1)]\nvoid compute(uint3 dispatchThreadID : SV_DispatchThreadID) {\n}\n',
        };
        const template = templates[payload.fileType];
        if (template === undefined) {
          return;
        }
        const requested = this.prompt('Create file', payload.suggestedPath)?.trim();
        if (!requested) {
          return;
        }
        const path = this.resolveSourcePath(shaderPath, requested);
        if (!path) {
          return;
        }
        if (!this.workspace.exists(path)) {
          this.workspace.writeText(path, template);
        }
        this.emitViewer({ type: 'fileSelected', payload: { path: requested, requestId: payload.requestId } });
        this.sendShaderList();
        return;
      }
      case 'requestFileContents': {
        const shaderPath = typeof payload.shaderPath === 'string' ? payload.shaderPath : this.activeShaderPath;
        if (!shaderPath || typeof payload.bufferName !== 'string') {
          return;
        }
        const path = this.sourcePaths(shaderPath)[payload.bufferName];
        if (path) {
          this.emitViewer({ type: 'fileContents', payload: {
            path, bufferName: payload.bufferName, code: this.workspace.exists(path) ? this.workspace.readText(path) : '',
          } });
        }
        return;
      }
      case 'updateShaderSource': {
        const path = typeof payload.path === 'string' ? payload.path : this.activeShaderPath;
        if (path && typeof payload.code === 'string' && this.workspace.exists(path)) {
          this.workspace.writeText(path, payload.code);
          const owner = this.activeShaderPath;
          const isBuffer = owner && Object.values(this.sourcePaths(owner)).includes(path);
          if (owner && (path === owner || isBuffer)) {
            this.emitViewer(this.shaderSourceMessage(owner));
          }
          this.sendShaderList();
        }
        return;
      }
      case 'updateConfig': {
        const shaderPath = typeof payload.shaderPath === 'string' ? payload.shaderPath
          : typeof payload.path === 'string' ? payload.path : this.activeShaderPath;
        if (shaderPath && typeof payload.text === 'string') {
          this.workspace.writeText(configPathForShader(shaderPath), payload.text);
          this.emitViewer(this.shaderSourceMessage(shaderPath));
          this.sendShaderList();
        }
        return;
      }
      case 'refresh':
        if (this.activeShaderPath) {
          this.emitViewer(this.shaderSourceMessage(this.activeShaderPath));
        }
        return;
      case 'requestLayout':
        this.emitViewer({ type: 'restoreLayout', payload: { layoutSlot: payload.layoutSlot ?? null, state: null } });
        return;
      case 'requestWorkspaceFiles':
        this.emitViewer({ type: 'workspaceFiles', payload: { files: [] } });
        return;
      default:
        return;
    }
  }

  readEditorFile(path: string): string | null {
    return this.workspace.exists(path) ? this.workspace.readText(path) : null;
  }

  async handleExplorerMessage(message: HostMessage): Promise<void> {
    switch (message.type) {
      case 'requestShaders':
        this.sendShaderList();
        return;
      case 'requestShaderCode':
        if (typeof message.path === 'string' && this.workspace.exists(message.path)) {
          this.emitExplorer({
            ...this.shaderCodeMessage(message.path),
            requestId: message.requestId,
          });
        }
        return;
      case 'saveState':
        this.workspace.writeText(EXPLORER_STATE_PATH, JSON.stringify(message.state ?? null));
        return;
      case 'saveThumbnail':
        if (typeof message.path === 'string' && typeof message.thumbnail === 'string' && this.workspace.exists(message.path)) {
          this.workspace.writeText(this.thumbnailPath(message.path), JSON.stringify({
            thumbnail: message.thumbnail,
            modifiedTime: message.modifiedTime,
          }));
        }
        return;
      case 'openShader':
      case 'activateShader':
        if (typeof message.path === 'string' && this.workspace.exists(message.path)) {
          this.setActiveShader(message.path);
          this.emitViewer(this.shaderSourceMessage(message.path));
        }
        return;
      case 'searchShaders': {
        const query = typeof message.query === 'string' ? message.query.trim().toLowerCase() : '';
        const paths = this.shaderFiles()
          .filter((file) => !query || `${file.path}\n${this.workspace.readText(file.path)}`.toLowerCase().includes(query))
          .map((file) => file.path);
        this.emitExplorer({ type: 'shaderSearchResults', query: message.query, requestId: message.requestId, paths });
        return;
      }
      case 'deleteShader':
        if (
          typeof message.path === 'string'
          && this.workspace.exists(message.path)
          && this.confirm(`Delete "${fileName(message.path)}"?`)
        ) {
          this.workspace.delete(message.path);
          const configPath = configPathForShader(message.path);
          if (this.workspace.exists(configPath)) {
            this.workspace.delete(configPath);
          }
          if (this.activeShaderPath === message.path) {
            this.activeShaderPath = this.shaderFiles()[0]?.path ?? null;
            if (this.activeShaderPath) {
              this.setActiveShader(this.activeShaderPath);
              this.emitViewer(this.shaderSourceMessage(this.activeShaderPath));
            } else if (this.workspace.exists(ACTIVE_SHADER_PATH)) {
              this.workspace.delete(ACTIVE_SHADER_PATH);
            }
          }
          this.sendShaderList();
        }
        return;
      case 'newShader': {
        this.emitViewer({ type: 'showNewShaderModal' });
        return;
      }
      case 'renameShader': {
        if (typeof message.path !== 'string' || !this.workspace.exists(message.path)) {
          return;
        }
        const currentName = fileName(message.path);
        const requestedName = this.prompt('Rename shader', currentName)?.trim();
        if (!requestedName || requestedName === currentName || !/^[^/\\]+\.(glsl|frag|slang)$/i.test(requestedName)) {
          return;
        }
        const destination = `${message.path.slice(0, message.path.lastIndexOf('/') + 1)}${requestedName}`;
        if (this.workspace.exists(destination)) {
          return;
        }
        this.workspace.rename(message.path, destination);
        const oldConfig = configPathForShader(message.path);
        if (this.workspace.exists(oldConfig)) {
          this.workspace.rename(oldConfig, configPathForShader(destination));
        }
        if (this.activeShaderPath === message.path) {
          this.setActiveShader(destination);
          this.emitViewer(this.shaderSourceMessage(destination));
        }
        this.sendShaderList();
        return;
      }
      default:
        return;
    }
  }

  async flush(): Promise<void> {
    await this.workspace.flush();
  }

  private shaderFiles() {
    return this.workspace.list().filter((file) => /\.(glsl|frag|slang)$/i.test(file.path));
  }

  private sendShaderList(): void {
    this.emitExplorer({
      type: 'shadersUpdate',
      shaders: this.shaderFiles().map((file) => {
        const configPath = configPathForShader(file.path);
        return {
          name: fileName(file.path),
          path: file.path,
          relativePath: relativePath(file.path),
          configPath: this.workspace.exists(configPath) ? configPath : undefined,
          hasConfig: this.workspace.exists(configPath),
          cachedThumbnail: this.cachedThumbnail(file.path, file.modifiedAt),
          createdTime: file.createdAt,
          modifiedTime: file.modifiedAt,
        };
      }),
      savedState: this.readExplorerState(),
    });
  }

  private resolveSourcePath(shaderPath: string, sourcePath: string): string | null {
    const path = sourcePath.startsWith('/') ? sourcePath
      : `${shaderPath.slice(0, shaderPath.lastIndexOf('/') + 1)}${sourcePath}`;
    const parts: string[] = [];
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') {
        continue;
      }
      if (part === '..') {
        if (!parts.length) {
          return null;
        }
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    return `/${parts.join('/')}`;
  }

  private sourcePaths(shaderPath: string): Record<string, string> {
    const paths: Record<string, string> = {};
    const config = this.readConfig(shaderPath).config;
    for (const [name, pass] of Object.entries(config?.passes ?? {})) {
      if (!pass) {
        continue;
      }
      for (const [key, source] of [
        [name, 'path' in pass ? pass.path : undefined],
        [`__shader_studio_vertex__:${name}`, 'vertex' in pass ? pass.vertex : undefined],
      ]) {
        if (typeof source !== 'string' || !source || !key) {
          continue;
        }
        const path = this.resolveSourcePath(shaderPath, source);
        if (path) {
          paths[key] = path;
        }
      }
    }
    return paths;
  }

  private bufferSources(shaderPath: string): Record<string, string> {
    return Object.fromEntries(Object.entries(this.sourcePaths(shaderPath))
      .filter(([, path]) => this.workspace.exists(path))
      .map(([name, path]) => [name, this.workspace.readText(path)]));
  }

  private shaderCodeMessage(path: string): HostMessage {
    const configResult = this.readConfig(path);
    return {
      type: 'shaderCode',
      path,
      previewPath: path,
      code: this.workspace.readText(path),
      config: configResult.config,
      configError: configResult.error,
      buffers: this.bufferSources(path),
      language: shaderLanguage(path),
    };
  }

  private setActiveShader(path: string): void {
    this.activeShaderPath = path;
    this.workspace.writeText(ACTIVE_SHADER_PATH, path);
  }

  private thumbnailPath(shaderPath: string): string {
    return `/.shader-studio/thumbnails/${encodeURIComponent(shaderPath)}.json`;
  }

  private cachedThumbnail(shaderPath: string, modifiedTime: number): string | undefined {
    const path = this.thumbnailPath(shaderPath);
    if (!this.workspace.exists(path)) {
      return undefined;
    }
    try {
      const stored = JSON.parse(this.workspace.readText(path)) as { thumbnail?: unknown; modifiedTime?: unknown };
      return typeof stored.thumbnail === 'string' && stored.modifiedTime === modifiedTime
        ? stored.thumbnail
        : undefined;
    } catch {
      return undefined;
    }
  }

  private readExplorerState(): unknown {
    if (!this.workspace.exists(EXPLORER_STATE_PATH)) {
      return null;
    }
    try {
      return JSON.parse(this.workspace.readText(EXPLORER_STATE_PATH));
    } catch {
      return null;
    }
  }

  private navigationPaths(shaderPath: string, config: ShaderConfig | null): Record<string, string> {
    const paths: Record<string, string> = { ...this.sourcePaths(shaderPath), Image: shaderPath };
    const references = [config?.script, ...Object.values(config?.passes ?? {}).map((pass) =>
      pass && 'vertex' in pass ? pass.vertex : undefined)];
    for (const reference of references) {
      if (typeof reference === 'string' && reference) {
        const resolved = this.resolveSourcePath(shaderPath, reference);
        if (resolved) {
          paths[reference] = resolved;
        }
      }
    }
    return paths;
  }

  private shaderSourceMessage(path: string): HostMessage {
    const codeMessage = this.shaderCodeMessage(path);
    const config = codeMessage.config as ShaderConfig | null;
    return {
      type: 'shaderSource',
      path,
      code: codeMessage.code,
      originalCode: codeMessage.code,
      config,
      buffers: codeMessage.buffers,
      bufferPathMap: this.navigationPaths(path, config),
      pathMap: this.assetPathMap(config),
      language: codeMessage.language,
    };
  }

  private readConfig(shaderPath: string): { config: ShaderConfig | null; error?: string } {
    const path = configPathForShader(shaderPath);
    if (!this.workspace.exists(path)) {
      return { config: null };
    }
    try {
      const config = JSON.parse(this.workspace.readText(path)) as ShaderConfig;
      this.resolveConfigAssets(config);
      return { config };
    } catch {
      return { config: null, error: `Failed to parse config: ${path}` };
    }
  }

  private resolveConfigAssets(config: ShaderConfig): void {
    for (const pass of Object.values(config.passes ?? {})) {
      for (const input of Object.values(pass?.inputs ?? {})) {
        if ('path' in input && typeof input.path === 'string') {
          const resolved = this.resolveDefaultAsset(input.path);
          if (resolved) {
            input.resolved_path = resolved;
          }
        }
      }
    }
  }

  private assetPathMap(config: ShaderConfig | null): Record<string, string> {
    const result: Record<string, string> = {};
    for (const pass of Object.values(config?.passes ?? {})) {
      for (const input of Object.values(pass?.inputs ?? {})) {
        if ('path' in input && typeof input.path === 'string' && 'resolved_path' in input && typeof input.resolved_path === 'string') {
          result[input.path] = input.resolved_path;
        }
      }
    }
    return result;
  }

  private emitViewer(message: HostMessage): void {
    for (const handler of this.viewerHandlers) {
      handler(message);
    }
  }

  private emitExplorer(message: HostMessage): void {
    for (const handler of this.explorerHandlers) {
      handler(message);
    }
  }
}
