import type { ShaderConfig } from '@shader-studio/types';
import type { VirtualWorkspace } from './VirtualWorkspace';

type HostMessage = { type: string; [key: string]: unknown };
type MessageHandler = (message: HostMessage) => void;
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
      case 'updateShaderSource': {
        const path = typeof payload.path === 'string' ? payload.path : this.activeShaderPath;
        if (path && typeof payload.code === 'string' && this.workspace.exists(path)) {
          this.workspace.writeText(path, payload.code);
          this.setActiveShader(path);
          this.emitViewer(this.shaderSourceMessage(path));
          this.sendShaderList();
        }
        return;
      }
      case 'updateConfig': {
        const shaderPath = typeof payload.path === 'string' ? payload.path : this.activeShaderPath;
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

  private shaderCodeMessage(path: string): HostMessage {
    const configResult = this.readConfig(path);
    return {
      type: 'shaderCode',
      path,
      previewPath: path,
      code: this.workspace.readText(path),
      config: configResult.config,
      configError: configResult.error,
      buffers: {},
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

  private shaderSourceMessage(path: string): HostMessage {
    const codeMessage = this.shaderCodeMessage(path);
    const config = codeMessage.config as ShaderConfig | null;
    return {
      type: 'shaderSource',
      path,
      code: codeMessage.code,
      originalCode: codeMessage.code,
      config,
      buffers: {},
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
