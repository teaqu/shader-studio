import { configPathForShader, shaderLanguageForPath, type ViewerRpcRequest, type ViewerSnapshot } from '@shader-studio/types';
import type { McpApplication } from '@shader-studio/utils';
import type { VirtualWorkspace } from './VirtualWorkspace';
import type { WebExtensionHost } from './WebExtensionHost';
import type { StandalonePreviews } from './StandalonePreviews';
import { createWorkspaceFile, workspaceUserPath } from './workspaceFiles';
import { getEditorDocument, setEditorDocument } from './state/editorDocuments.svelte';

const automation = new Set(['inject_input', 'start_input_recording', 'stop_input_recording', 'get_input_recording',
  'replay_inputs', 'get_input_replay', 'cancel_input_replay', 'read_feedback',
  'start_frame_capture', 'get_frame_capture', 'cancel_frame_capture']);

function summary(state: ViewerSnapshot) {
  const { path, language, compileSequence, renderedSequence, compiling, errors, warnings, time, frame, paused, width, height } = state;
  return { path, language, compileSequence, renderedSequence, compiling, errors, warnings, time, frame, paused, width, height };
}

/** Never send frame/image base64 to a text-only WebMCP consumer. */
function frameMetadata(result: Record<string, unknown>): Record<string, unknown> {
  const { data: _data, ...metadata } = result;
  if (Array.isArray(metadata.frames)) {
    metadata.frames = metadata.frames.map(frame => frame && typeof frame === 'object'
      ? frameMetadata(frame as Record<string, unknown>) : frame);
  }
  return metadata;
}

export interface McpEditorAccess {
  read(path: string): string | undefined;
  commit(path: string, text: string): void;
}

export class StandaloneMcpApplication implements McpApplication {
  private editors?: McpEditorAccess;
  private readonly revisions = new Map<string, { text: string; revision: string }>();
  private edits: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly workspace: VirtualWorkspace,
    private readonly host: WebExtensionHost,
    private readonly previews: StandalonePreviews,
    private readonly flushEditors: () => Promise<void>,
    private readonly loadEditors?: () => Promise<McpEditorAccess>,
  ) {}

  async call(operation: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    await this.prepareEditors(operation, signal);
    if (operation === 'update_file' || operation === 'create_file') {
      const edit = this.edits.then(async () => {
        await this.flushEditors();
        signal.throwIfAborted();
        return operation === 'update_file' ? this.updateFile(args, signal) : this.createFile(args);
      });
      this.edits = edit.catch(() => {});
      return edit;
    }
    if (operation === 'list_files') {
      return this.listFiles(args);
    }
    if (operation === 'read_file') {
      await this.flushEditors();
      return this.readFile(String(args.path));
    }
    if (operation === 'list_previews') {
      return { previews: await Promise.all(this.previews.list().map(async preview => {
        try {
          return { ...preview, ...summary(await this.previews.request(preview.id, 'get_state', {}, signal)) };
        } catch (error) {
          return { ...preview, error: String(error) };
        }
      })) };
    }
    if (operation === 'get_shader' || operation === 'get_settings') {
      await this.flushEditors();
    }
    const id = this.previews.select(args.previewId as string | undefined);
    const state = await this.previews.request(id, 'get_state', {}, signal);
    if (operation === 'select_shader') {
      const path = workspaceUserPath(String(args.path));
      await this.flushEditors();
      if (!shaderLanguageForPath(path)) {
        throw new Error('Select an existing shader file.');
      }
      this.readFile(path);
      await this.previews.request(id, 'select_shader', { path, expectedPath: state.path }, signal);
      const source = this.host.prepareShader(path);
      await this.previews.sendSource(id, source);
      return { previewId: id, ...summary(await this.previews.request(id, 'get_state', {
        requiredPath: path, requiredSequence: source.compileSequence,
      }, signal)) };
    }
    const inspection = this.inspectViewer(operation, id, state);
    if (inspection) {
      return inspection;
    }
    if (automation.has(operation)) {
      const { previewId: _previewId, ...payload } = args;
      const result = await this.previews.request(id, operation as ViewerRpcRequest['operation'], { ...payload, expectedPath: state.path }, signal);
      return { previewId: id, ...summary(result), ...frameMetadata(result.automation ?? {}) };
    }
    if (operation === 'read_storage') {
      const result = await this.previews.request(id, 'read_storage', { name: args.name, start: args.start, count: args.count, expectedPath: state.path }, signal);
      return { previewId: id, ...summary(result), storage: result.storageRead };
    }
    if (operation === 'update_settings' || operation === 'set_playback') {
      const keys = operation === 'update_settings' ? ['fpsLimit', 'speed', 'uniforms'] : ['paused', 'reset', 'time'];
      const payload = Object.fromEntries(keys.filter(key => args[key] !== undefined).map(key => [key, args[key]]));
      await this.previews.request(id, operation === 'update_settings' ? 'settings' : 'playback', { ...payload, expectedPath: state.path }, signal);
      return this.output(id, state.path, args.includePreview === true, signal);
    }
    if (operation === 'capture_output') {
      return this.output(id, state.path, true, signal);
    }
    throw new Error('Unsupported standalone operation.');
  }

  private async prepareEditors(operation: string, signal: AbortSignal): Promise<void> {
    if (['read_file', 'create_file', 'update_file', 'get_shader', 'get_settings'].includes(operation)) {
      this.editors ??= await this.loadEditors?.();
      signal.throwIfAborted();
    }
  }

  private inspectViewer(operation: string, id: string, state: ViewerSnapshot): Record<string, unknown> | undefined {
    if (operation === 'get_shader') {
      return { previewId: id, ...this.readFile(state.path), ...summary(state) };
    }
    if (operation === 'get_settings') {
      const path = configPathForShader(state.path);
      return { previewId: id, viewer: { ...summary(state), fpsLimit: state.fpsLimit, speed: state.speed, uniforms: state.uniforms },
        configFile: this.workspace.exists(path) ? this.readFile(path) : null };
    }
    if (operation === 'get_diagnostics') {
      return { previewId: id, ...summary(state) };
    }
    if (operation === 'get_resources') {
      return { previewId: id, ...state.resources };
    }
    if (operation === 'get_inputs') {
      return { previewId: id, ...state.inputs };
    }
    return undefined;
  }

  private listFiles(args: Record<string, unknown>): Record<string, unknown> {
    const glob = typeof args.glob === 'string' ? args.glob : '**';
    const pattern = new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*') + '$');
    const files = this.workspace.list().filter(file => !file.path.startsWith('/.shader-studio/')
        && pattern.test(glob.startsWith('/') ? file.path : file.path.slice(1)));
    return { files: files.slice(0, 500).map(file => ({ path: file.path })), truncated: files.length > 500 };
  }

  private readFile(requested: string): Record<string, unknown> {
    const path = workspaceUserPath(requested);
    const stored = this.workspace.readText(path);
    const text = this.editors?.read(path) ?? getEditorDocument(path) ?? stored;
    this.validateText(text);
    return { path, text, revision: this.revision(path, text), dirty: text !== stored };
  }

  private revision(path: string, text: string): string {
    let current = this.revisions.get(path);
    if (!current || current.text !== text) {
      current = { text, revision: crypto.randomUUID() };
      this.revisions.set(path, current);
    }
    return current.revision;
  }

  private validateText(text: unknown): asserts text is string {
    if (typeof text !== 'string' || text.length > 1_000_000 || text.includes('\0') || text.startsWith('data:')) {
      throw new Error('File is not supported text (limit 1 MB; binary assets cannot be edited).');
    }
  }

  private async createFile(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.validateText(args.text);
    const path = createWorkspaceFile(this.workspace, String(args.path));
    this.workspace.writeText(path, args.text);
    await this.workspace.flush();
    this.editors?.commit(path, args.text);
    setEditorDocument(path, args.text);
    return { ...this.readFile(path), created: true };
  }

  private async updateFile(args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const file = this.readFile(String(args.path));
    if (file.revision !== args.expectedRevision) {
      throw new Error('File changed since it was read. Call read_file and retry with its revision.');
    }
    this.validateText(args.text);
    const path = String(file.path);
    const id = args.previewId !== undefined || args.includePreview === true || this.previews.list().length === 1
      ? this.previews.select(args.previewId as string | undefined) : undefined;
    const state = id ? await this.previews.request(id, 'get_state', {}, signal) : undefined;
    const uri = 'file://' + path.split('/').map(encodeURIComponent).join('/');
    await this.host.applyWorkspaceEdit([{ uri, before: String(file.text), after: args.text }],
      () => !signal.aborted && this.readFile(path).revision === file.revision,
      () => {
        this.editors?.commit(path, String(args.text));
        setEditorDocument(path, String(args.text));
      }, new Map([[uri, String(file.text)]]));
    const edited = { path, editedPath: path, revision: this.revision(path, args.text), editedRevision: this.revision(path, args.text), applied: true };
    try {
      return { ...edited, ...(id && state ? await this.output(id, state.path, args.includePreview === true, signal) : {}) };
    } catch (error) {
      return { ...edited, previewError: error instanceof Error ? error.message : String(error) };
    }
  }

  private async output(id: string, path: string, capture: boolean, signal: AbortSignal): Promise<Record<string, unknown>> {
    const state = await this.previews.request(id, capture ? 'capture' : 'get_state', { expectedPath: path }, signal);
    return { previewId: id, ...summary(state), fpsLimit: state.fpsLimit, speed: state.speed, uniforms: state.uniforms,
      ...(capture ? { output: { mimeType: 'image/png', availableInCanvas: true } } : {}) };
  }
}
