import type {
  BaseMessage,
  LanguageServiceSettingsMessage,
  ShaderConfig,
  ShaderSourceMessage,
} from '@shader-studio/types';
import type { Transport, TransportMessage } from './MessageTransport';

type DemoExampleId = 'glsl' | 'slang' | 'image' | 'video' | 'cubemap';
const DEMO_STORAGE_KEY = 'shader-studio-demo-state';

function thisIsDemoExampleId(value: unknown): value is DemoExampleId {
  return value === 'glsl' || value === 'slang' || value === 'image' || value === 'video' || value === 'cubemap';
}

interface DemoExample {
  path: string;
  language: 'glsl' | 'slang';
  code: string;
  config: ShaderConfig;
}

export const DEMO_EXAMPLE_TABS: ReadonlyArray<{ id: DemoExampleId; label: string }> = [
  { id: 'glsl', label: 'GLSL' },
  { id: 'slang', label: 'Slang' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'cubemap', label: 'Cubemap' },
];

export const DEMO_EXPLORER_SHADERS: ReadonlyArray<{
  id: DemoExampleId;
  label: string;
  language: string;
  description: string;
}> = [
  { id: 'glsl', label: 'Aurora', language: 'GLSL', description: 'A live-editable animated GLSL shader.' },
  { id: 'slang', label: 'Aurora Slang', language: 'Slang', description: 'An animated Slang shader with a WebGPU preview.' },
  { id: 'image', label: 'Nebula texture', language: 'GLSL · Image', description: 'Samples the bundled generated image.' },
  { id: 'video', label: 'Nebula motion', language: 'GLSL · Video', description: 'Samples the bundled looping video.' },
  { id: 'cubemap', label: 'Desert skybox', language: 'GLSL · Cubemap', description: 'Drag in the preview to look around.' },
];

const EMPTY_CONFIG: ShaderConfig = {
  version: '1.0',
  passes: { Image: { inputs: {} } },
};

const PREVIOUS_BUNDLED_CUBEMAP_CODE = `// Bundled cubemap input demo
// iChannel0 is a generated desert skybox cross layout.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  vec3 direction = normalize(vec3(p, 1.5));
  fragColor = vec4(texture(iChannel0, direction).rgb, 1.0);
}`;

const PREVIOUS_BUNDLED_SLANG_CODE = `// Shader Studio Slang / WebGPU demo

float4 mainImage(float2 fragCoord)
{
  float2 uv = fragCoord / iResolution.xy;
  float3 colour = 0.5 + 0.5 * cos(iTime + uv.xyx * 4.0 + float3(0.0, 2.0, 4.0));
  return float4(colour, 1.0);
}`;

function assetConfig(type: 'texture' | 'video' | 'cubemap', path: string): ShaderConfig {
  return {
    version: '1.0',
    passes: {
      Image: {
        inputs: {
          iChannel0: { type, path, resolved_path: `./${path}`, filter: 'linear', wrap: 'repeat' },
        },
      },
    },
  };
}

function cloneConfig(config: ShaderConfig): ShaderConfig {
  return structuredClone(config);
}

const DEMO_EXAMPLES: Record<DemoExampleId, DemoExample> = {
  glsl: {
    path: '/examples/aurora.glsl',
    language: 'glsl',
    code: `// Shader Studio browser demo
// Edit this shader and see the preview update live.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	vec2 p = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
	float wave = sin(p.x * 3.0 + iTime) + sin(p.y * 4.0 - iTime * 0.7);
	vec3 sky = 0.5 + 0.5 * cos(iTime + uv.xyx * 3.0 + vec3(0.0, 2.0, 4.0));
	fragColor = vec4(sky + 0.15 * wave, 1.0);
}`,
    config: EMPTY_CONFIG,
  },
  slang: {
    path: '/examples/nebula.slang',
    language: 'slang',
    code: `// Shader Studio Aurora Slang / WebGPU demo

float4 mainImage(float2 fragCoord)
{
	float2 uv = fragCoord / iResolution.xy;
	float3 colour = 0.5 + 0.5 * cos(iTime + uv.xyx * 4.0 + float3(0.0, 2.0, 4.0));
	return float4(colour, 1.0);
}`,
    config: EMPTY_CONFIG,
  },
  image: {
    path: '/examples/image.glsl',
    language: 'glsl',
    code: `// Bundled image input demo
// iChannel0 is the generated nebula texture.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	vec3 image = texture(iChannel0, uv).rgb;
	fragColor = vec4(image, 1.0);
}`,
    config: assetConfig('texture', 'demo-assets/nebula-texture.png'),
  },
  video: {
    path: '/examples/video.glsl',
    language: 'glsl',
    code: `// Bundled video input demo
// iChannel0 is a short looping generated nebula animation.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	vec3 video = texture(iChannel0, uv).rgb;
	fragColor = vec4(video, 1.0);
}`,
    config: assetConfig('video', 'demo-assets/nebula-motion.mp4'),
  },
  cubemap: {
    path: '/examples/cubemap.glsl',
    language: 'glsl',
    code: `// Bundled cubemap input demo
// Drag in the preview to look around the generated desert skybox.

mat2 rotate(float angle) {
	float c = cos(angle);
	float s = sin(angle);
	return mat2(c, -s, s, c);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	vec2 p = uv * 2.0 - 1.0;
	vec3 direction = normalize(vec3(p, 1.5));
	vec2 orbit = iMouse.z == 0.0 ? vec2(0.0) : iMouse.xy / iResolution.xy - 0.5;
	direction.xz = rotate(-orbit.x * 6.283185) * direction.xz;
	direction.yz = rotate(orbit.y * 3.141593) * direction.yz;
	fragColor = vec4(texture(iChannel0, direction).rgb, 1.0);
}`,
    config: assetConfig('cubemap', 'demo-assets/desert-cubemap-cross.png'),
  },
};

export function demoExampleIdForPath(path: unknown): DemoExampleId | null {
  for (const id of Object.keys(DEMO_EXAMPLES) as DemoExampleId[]) {
    if (DEMO_EXAMPLES[id].path === path) {
      return id;
    }
  }
  return null;
}

export function demoShaderPreviewForPath(path: string): {
  code: string;
  config: ShaderConfig;
  language: 'glsl' | 'slang';
  previewPath: string;
} | null {
  const id = path.startsWith('demo://') ? path.slice('demo://'.length) : '';
  if (!thisIsDemoExampleId(id)) {
    return null;
  }
  const example = DEMO_EXAMPLES[id];
  return {
    code: example.code,
    config: cloneConfig(example.config),
    language: example.language,
    previewPath: example.path,
  };
}

interface DemoState {
  selectedExample: DemoExampleId;
  codeByExample: Record<DemoExampleId, string>;
  config: ShaderConfig;
}

type PayloadMessage = BaseMessage & { payload?: unknown };

interface StoredDemoState {
  selectedExample?: unknown;
  codeByExample?: unknown;
  config?: unknown;
}

function initialState(): DemoState {
  return {
    selectedExample: 'glsl',
    codeByExample: {
      glsl: DEMO_EXAMPLES.glsl.code,
      slang: DEMO_EXAMPLES.slang.code,
      image: DEMO_EXAMPLES.image.code,
      video: DEMO_EXAMPLES.video.code,
      cubemap: DEMO_EXAMPLES.cubemap.code,
    },
    config: cloneConfig(DEMO_EXAMPLES.glsl.config),
  };
}

function loadState(): DemoState {
  const defaults = initialState();
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const stored = JSON.parse(raw) as StoredDemoState;
    const selectedExample = thisIsDemoExampleId(stored.selectedExample)
      ? stored.selectedExample
      : defaults.selectedExample;
    const savedCodeByExample = stored.codeByExample && typeof stored.codeByExample === 'object'
      ? stored.codeByExample as Record<string, unknown>
      : null;
    const codeByExample = savedCodeByExample
      ? {
        glsl: typeof savedCodeByExample.glsl === 'string' ? savedCodeByExample.glsl : defaults.codeByExample.glsl,
        slang: savedCodeByExample.slang === PREVIOUS_BUNDLED_SLANG_CODE
          ? defaults.codeByExample.slang
          : typeof savedCodeByExample.slang === 'string' ? savedCodeByExample.slang : defaults.codeByExample.slang,
        image: typeof savedCodeByExample.image === 'string' ? savedCodeByExample.image : defaults.codeByExample.image,
        video: typeof savedCodeByExample.video === 'string' ? savedCodeByExample.video : defaults.codeByExample.video,
        cubemap: savedCodeByExample.cubemap === PREVIOUS_BUNDLED_CUBEMAP_CODE
          ? defaults.codeByExample.cubemap
          : typeof savedCodeByExample.cubemap === 'string' ? savedCodeByExample.cubemap : defaults.codeByExample.cubemap,
      }
      : defaults.codeByExample;
    const config = stored.config && typeof stored.config === 'object'
      ? stored.config as ShaderConfig
      : defaults.config;
    return { selectedExample, codeByExample, config };
  } catch {
    return defaults;
  }
}

/**
 * Browser-only transport used by the public demo build. It intentionally
 * implements only the messages needed to load and edit one bundled shader.
 */
export class DemoTransport implements Transport {
  private handlers: Array<(event: MessageEvent) => void> = [];
  private state = loadState();
  private connected = true;
  private initialDeliveryScheduled = false;

  onMessage(handler: (event: MessageEvent) => void): void {
    if (!this.connected) {
      return;
    }
    this.handlers.push(handler);
    this.scheduleInitialDelivery();
  }

  postMessage<const TMessage extends BaseMessage>(message: TransportMessage<TMessage>): void {
    if (!this.connected) {
      return;
    }

    const payloadMessage = message as PayloadMessage;

    if (message.type === 'languageServiceReady') {
      this.emitLanguageServiceSettings();
      return;
    }

    if (payloadMessage.type === 'updateShaderSource') {
      const payload = payloadMessage.payload;
      const example = this.currentExample;
      if (
        payload
        && typeof payload === 'object'
        && 'path' in payload
        && 'code' in payload
        && payload.path === example.path
        && typeof payload.code === 'string'
      ) {
        this.state = {
          ...this.state,
          codeByExample: { ...this.state.codeByExample, [this.state.selectedExample]: payload.code },
        };
        this.persist();
        this.emitShaderSource();
      }
      return;
    }

    if (payloadMessage.type === 'updateConfig') {
      const payload = payloadMessage.payload;
      if (payload && typeof payload === 'object' && 'config' in payload && payload.config && typeof payload.config === 'object') {
        this.state = { ...this.state, config: payload.config as ShaderConfig };
        this.persist();
        this.emitShaderSource();
      }
      return;
    }

    if (payloadMessage.type === 'selectDemoExample') {
      const payload = payloadMessage.payload;
      if (payload && typeof payload === 'object' && 'id' in payload && this.isDemoExampleId(payload.id)) {
        this.state = {
          ...this.state,
          selectedExample: payload.id,
          config: cloneConfig(DEMO_EXAMPLES[payload.id].config),
        };
        this.persist();
        this.emitShaderSource();
      }
      return;
    }

    if (payloadMessage.type === 'resetDemoState') {
      this.state = initialState();
      this.clearPersistedState();
      this.emitShaderSource();
      return;
    }

    if (message.type === 'refresh') {
      this.emitShaderSource();
    }
  }

  dispose(): void {
    this.connected = false;
    this.handlers = [];
  }

  getType(): 'demo' {
    return 'demo';
  }

  isConnected(): boolean {
    return this.connected;
  }

  private scheduleInitialDelivery(): void {
    if (this.initialDeliveryScheduled) {
      return;
    }
    this.initialDeliveryScheduled = true;
    queueMicrotask(() => {
      if (this.connected) {
        this.emitShaderSource();
      }
    });
  }

  private emitShaderSource(): void {
    const example = this.currentExample;
    const message: ShaderSourceMessage = {
      type: 'shaderSource',
      code: this.state.codeByExample[this.state.selectedExample],
      originalCode: this.state.codeByExample[this.state.selectedExample],
      config: this.state.config,
      path: example.path,
      buffers: {},
      pathMap: this.assetPathMap(this.state.config),
      language: example.language,
    };
    const event = new MessageEvent('message', { data: message });
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  private emitLanguageServiceSettings(): void {
    const message: LanguageServiceSettingsMessage = {
      type: 'languageServiceSettings',
      payload: {
        glslEnabled: true,
        slangEnabled: true,
        colorDecorators: true,
        trace: 'off',
      },
    };
    const event = new MessageEvent('message', { data: message });
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  private get currentExample(): DemoExample {
    return DEMO_EXAMPLES[this.state.selectedExample];
  }

  private isDemoExampleId(value: unknown): value is DemoExampleId {
    return thisIsDemoExampleId(value);
  }

  private assetPathMap(config: ShaderConfig): Record<string, string> {
    const inputs = config.passes.Image?.inputs ?? {};
    return Object.fromEntries(
      Object.values(inputs).flatMap((input) => (
        'path' in input
          && typeof input.path === 'string'
          && 'resolved_path' in input
          && typeof input.resolved_path === 'string'
          ? [[input.path, input.resolved_path]]
          : []
      )),
    );
  }

  private persist(): void {
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // The demo remains usable when storage is unavailable or full.
    }
  }

  private clearPersistedState(): void {
    try {
      localStorage.removeItem(DEMO_STORAGE_KEY);
    } catch {
      // The in-memory reset still succeeds when storage is unavailable.
    }
  }
}
