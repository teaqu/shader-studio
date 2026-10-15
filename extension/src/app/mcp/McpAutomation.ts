import type { ViewerAutomationOperation } from '@shader-studio/types';
import type { PreviewRegistry } from './PreviewRegistry';
import { McpRecordingArtifacts } from './McpRecordingArtifacts';

const operations = new Set<string>([
  'inject_input', 'start_input_recording', 'stop_input_recording', 'get_input_recording',
  'replay_inputs', 'get_input_replay', 'cancel_input_replay', 'read_feedback',
  'start_recording', 'stop_recording', 'get_recording',
  'start_frame_capture', 'get_frame_capture', 'cancel_frame_capture',
]);
const inspection = new Set(['stop_recording', 'get_recording', 'stop_input_recording', 'get_input_recording', 'get_input_replay', 'cancel_input_replay', 'get_frame_capture', 'cancel_frame_capture']);
export const isAutomationOperation = (operation: string): boolean => operations.has(operation);

/** Routes long-lived jobs without holding an MCP request open for their duration. */
export class McpAutomation {
  private readonly revisions = new Map<string, { path: string; revision: unknown }>();

  constructor(
    private readonly previews: PreviewRegistry,
    private readonly artifacts: McpRecordingArtifacts,
    private readonly readFile: (path: string) => Promise<Record<string, unknown>>,
  ) {}

  readArtifact(id: string): Promise<{ mimeType: string; data: string }> {
    return this.artifacts.read(id);
  }

  async call(id: string, operation: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (!operations.has(operation)) {
      throw new Error('Unknown automation operation.');
    }
    const payload = { ...args };
    delete payload.previewId;
    let revision: { path: string; revision: unknown } | undefined;
    if (!inspection.has(operation)) {
      const state = await this.previews.request(id, 'get_state', {}, signal);
      if (!state.path) {
        throw new Error('No shader is loaded.');
      }
      payload.expectedPath = state.path;
      if (operation === 'start_recording' || operation === 'start_frame_capture') {
        const file = await this.readFile(state.path);
        revision = { path: state.path, revision: file.revision };
      }
    }
    const response = await this.previews.request(id, operation as ViewerAutomationOperation, payload, signal);
    const result = response.automation;
    if (!result) {
      throw new Error('This preview does not support automation. Reload it with the current extension.');
    }
    const jobKey = `${id}:${String(result.id)}`;
    if (revision) {
      this.revisions.set(jobKey, revision);
      if (this.revisions.size > 30) {
        this.revisions.delete(this.revisions.keys().next().value!);
      }
    }
    if (['start_recording', 'stop_recording', 'get_recording', 'start_frame_capture', 'get_frame_capture', 'cancel_frame_capture'].includes(operation)) {
      const source = result.source as Record<string, unknown> | undefined;
      const recorded = this.revisions.get(jobKey);
      if (source && recorded) {
        result.source = { ...source, revision: recorded.revision };
      }
      const artifact = result.artifact as { available?: boolean; bytes?: number } | undefined;
      if (result.state === 'completed' && artifact?.available) {
        result.artifact = await this.artifacts.save(jobKey, String(result.mimeType), Number(artifact.bytes), async (offset, maxBytes) => {
          const chunk = (await this.previews.request(id, 'read_recording_chunk', { id: result.id, offset, maxBytes }, signal)).automation;
          if (!chunk) {
            throw new Error('Preview did not return recording data.');
          }
          return { offset: Number(chunk.offset), totalBytes: Number(chunk.totalBytes), data: String(chunk.base64) };
        }, signal);
      }
    }
    return { previewId: id, path: response.path, time: response.time, frame: response.frame,
      compileSequence: response.compileSequence, renderedSequence: response.renderedSequence, ...result };
  }
}
