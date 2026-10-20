import { z } from 'zod';

export interface McpApplication {
  call(operation: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>>;
}

const previewId = z.string().optional().describe('Preview ID from list_previews. Omit only when exactly one preview is open.');
const requiredPreviewId = z.string().min(1).describe('Explicit preview ID returned by list_previews. Required because this operation changes or records live state.');
const includePreview = z.boolean().optional().describe('Return a fresh rendered image after the operation.');
const revision = z.string().describe('Revision returned by the most recent read. Prevents overwriting newer edits.');
const uniformValue = z.union([z.number().finite(), z.array(z.number().finite()).max(16), z.boolean()]);
const inputEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pointer_move'), x: z.number().finite(), y: z.number().finite() }).strict(),
  z.object({ type: z.literal('pointer_down'), x: z.number().finite(), y: z.number().finite(), button: z.literal(0).optional() }).strict(),
  z.object({ type: z.literal('pointer_up'), x: z.number().finite().optional(), y: z.number().finite().optional(), button: z.literal(0).optional() }).strict(),
  z.object({ type: z.literal('key_down'), code: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal('key_up'), code: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal('release_all') }).strict(),
]);

export interface McpToolDefinition {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  readOnly: boolean;
}

/** One contract for the local MCP server and browser WebMCP. */
export function mcpToolDefinitions(): McpToolDefinition[] {
  const tools: McpToolDefinition[] = [];
  const register = (name: string, description: string, shape: z.ZodRawShape, readOnly: boolean) => {
    tools.push({ name, description, shape, readOnly });
  };
  register('list_previews', 'List connected Shader Studio viewers with compact render/playback status. Use get_settings, get_inputs and get_resources for details.', {}, true);
  register('get_resources', 'List render, buffer, common and compute passes with source paths, and named GPU storage declarations. Edit their files with update_file.', { previewId }, true);
  register('read_storage', 'Read actual GPU storage bytes with element type, stride and frame metadata. WebGPU only. Pause first for a stable simulation snapshot. Maximum 64 KiB per read.', {
    previewId, name: z.string(), start: z.number().int().min(0).default(0), count: z.number().int().min(1).max(1024).default(16),
  }, true);
  register('start_log_collection', 'Explicitly start collecting extension, script console and viewer logs for a bounded duration. Off by default even when MCP is enabled. Starts a fresh shared collection, clearing earlier logs. Reproduce the problem after starting, then use get_logs.', {
    duration: z.number().min(1).max(300).default(60).describe('Collection duration in seconds; stops automatically at expiry.'),
  }, false);
  register('stop_log_collection', 'Stop collecting logs and return retained entries. get_logs can read the bounded history until collection restarts or MCP is disabled.', {}, false);
  register('get_logs', 'Read logs captured after start_log_collection; this read never starts collection. Returns collection status and expiry. Use after to continue from a cursor. At most 500 entries are retained in memory; disabling MCP clears them. previewId filters viewer entries and also includes unscoped extension/script logs.', {
    previewId, after: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200).default(100),
    level: z.enum(['debug', 'info', 'warning', 'error']).optional(),
  }, true);
  register('get_shader', 'Read the selected shader from its current editor document, including unsaved edits.', { previewId }, true);
  register('get_settings', 'Read shader configuration and runtime viewer settings, including configuration revision.', { previewId }, true);
  register('get_inputs', 'Inspect live Image-pass built-ins (including mouse), custom uniform values and last observed writers. Defaults/ranges are null when undeclared; live state can differ from a paused frame. Reports unavailable inputs explicitly.', { previewId }, true);
  register('update_settings', 'Update runtime viewer controls. Edit the configuration file using update_file for persistent shader settings. Uniform overrides are temporary; scripts can overwrite them.', {
    previewId,
    fpsLimit: z.number().min(0).max(1000).optional(), speed: z.number().min(0).max(100).optional(),
    uniforms: z.record(z.string(), uniformValue).optional(), includePreview,
  }, false);
  register('get_diagnostics', 'Read the selected preview compiler/runtime errors and warnings with revision markers.', { previewId }, true);
  register('capture_output', 'Render and return actual PNG pixels from the selected renderer. Preserves resolution/time; rendering can advance feedback buffers.', { previewId }, false);
  register('set_playback', 'Pause/resume, seek shader time, or reset the running simulation. Seeking does not reconstruct simulation history.', {
    previewId, paused: z.boolean().optional(), reset: z.boolean().optional(), time: z.number().finite().min(0).optional(), includePreview,
  }, false);
  register('list_files', 'List local workspace files. Results are bounded; use a glob to narrow large workspaces.', { glob: z.string().max(500).optional() }, true);
  register('read_file', 'Read an existing local workspace text file, including unsaved edits, and its revision.', { path: z.string() }, true);
  register('update_file', 'Replace an existing workspace text file with an undoable edit. Read read_file first; no arbitrary filesystem paths.', {
    path: z.string(), text: z.string().max(1_000_000), expectedRevision: revision, previewId, includePreview,
  }, false);
  register('create_file', 'Create a new text file in the trusted workspace. Refuses an existing file and never creates binary assets.', {
    path: z.string().min(1).max(1000), text: z.string().max(1_000_000),
  }, false);
  register('select_shader', 'Select a shader in one explicit preview. Use list_previews first.', { previewId: requiredPreviewId, path: z.string().min(1).max(1000) }, false);
  register('inject_input', 'Inject canonical pointer or keyboard events into one explicit preview. Events are temporary live input, not persistent shader edits.', {
    previewId: requiredPreviewId, events: z.array(inputEvent).min(1).max(256),
  }, false);
  register('start_input_recording', 'Start recording canonical live input events for one explicit preview.', { previewId: requiredPreviewId }, false);
  register('stop_input_recording', 'Stop input recording and return its bounded event timeline.', { previewId: requiredPreviewId }, false);
  register('get_input_recording', 'Read the current or completed input recording timeline for one explicit preview.', { previewId: requiredPreviewId }, true);
  register('replay_inputs', 'Replay the selected preview’s last recorded input timeline. Reset first when comparing feedback simulations: seeking cannot restore feedback history.', {
    previewId: requiredPreviewId, mode: z.enum(['from-current', 'reset-and-play']).default('from-current'),
  }, false);
  register('get_input_replay', 'Read input replay state for one explicit preview.', { previewId: requiredPreviewId }, true);
  register('cancel_input_replay', 'Cancel the current input replay in one explicit preview.', { previewId: requiredPreviewId }, false);
  register('read_feedback', 'Read a bounded RGBA feedback/pass region from one explicit preview. This is a GPU readback and may be unavailable for some backends.', {
    previewId: requiredPreviewId, pass: z.string().min(1).max(200), x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().min(1).max(1024), height: z.number().int().min(1).max(1024),
  }, true);
  register('start_recording', 'Start a bounded live MP4 or WebM recording for one explicit preview. The requested output size does not resize the preview or restore feedback state.', {
    previewId: requiredPreviewId, format: z.enum(['mp4', 'webm']), duration: z.number().min(0.1).max(60), fps: z.number().int().min(1).max(60), width: z.number().int().min(1).max(1920), height: z.number().int().min(1).max(1080), recordInputs: z.boolean().optional().describe('Also capture the selected preview input timeline for this video.'),
  }, false);
  register('stop_recording', 'Stop an active recording for one explicit preview. Use get_recording until its artifact is available.', { previewId: requiredPreviewId, id: z.string().min(1) }, false);
  register('get_recording', 'Read recording progress, timestamps, provenance, recompilation/switch flags, and artifact availability.', { previewId: requiredPreviewId, id: z.string().min(1) }, true);
  register('start_frame_capture', 'Start a bounded live wall-clock frame capture. Requested timestamps schedule captures; actual elapsed timestamps can differ. This neither seeks nor reconstructs feedback.', {
    previewId: requiredPreviewId, times: z.array(z.number().min(0).max(60)).min(1).max(8).superRefine((times, context) => {
      for (let index = 1; index < times.length; index++) {
        if (times[index] <= times[index - 1]) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'times must be sorted and unique.' });
        }
      }
    }),
    mode: z.enum(['from-current', 'reset-and-play']).default('from-current'), width: z.number().int().min(1).max(1920).default(800), height: z.number().int().min(1).max(1080).default(450),
  }, false);
  register('get_frame_capture', 'Read a frame-capture job. Completed frame PNGs are returned as ordered image content with metadata only in structured output.', { previewId: requiredPreviewId, id: z.string().min(1) }, true);
  register('cancel_frame_capture', 'Cancel an active frame-capture job.', { previewId: requiredPreviewId, id: z.string().min(1) }, false);
  return tools;
}

export function mcpToolSchema(tool: McpToolDefinition) {
  return z.object(tool.shape).strict();
}

export function mcpToolJsonSchema(tool: McpToolDefinition): Record<string, unknown> {
  return z.toJSONSchema(mcpToolSchema(tool), { io: 'input' });
}
