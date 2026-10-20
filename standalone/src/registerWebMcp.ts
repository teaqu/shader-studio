import { mcpToolDefinitions, mcpToolJsonSchema, mcpToolSchema, type McpApplication } from '@shader-studio/utils';

export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(args: Record<string, unknown>, client?: { signal?: AbortSignal }): Promise<string>;
}

export interface WebMcpContext {
  registerTool(tool: WebMcpTool, options?: { signal: AbortSignal }): void | Promise<void>;
  unregisterTool?(name: string): void;
}

// These operations need the extension's retained logs or disk artifact service.
const extensionOnly = new Set(['start_log_collection', 'stop_log_collection', 'get_logs',
  'start_recording', 'stop_recording', 'get_recording']);

export function detectWebMcp(): WebMcpContext | undefined {
  return (document as Document & { modelContext?: WebMcpContext }).modelContext
    ?? (navigator as Navigator & { modelContext?: WebMcpContext }).modelContext;
}

/** Native registration only: unsupported browsers continue without a shim. */
export function registerWebMcp(application: McpApplication, context = detectWebMcp()): () => void {
  if (!context) {
    return () => {};
  }
  const lifetime = new AbortController();
  const registered = new Set<string>();
  const unregister = (name: string) => {
    try {
      context.unregisterTool?.(name);
    } catch {
      // A signal-aware browser may already have removed the registration.
    }
    registered.delete(name);
  };
  for (const definition of mcpToolDefinitions().filter(tool => !extensionOnly.has(tool.name))) {
    const tool: WebMcpTool = {
      name: definition.name,
      description: definition.description
        .replace(/actual PNG pixels|actual rendered pixels/g, 'rendered output metadata (view pixels in the canvas)')
        .replace(/ordered image content/g, 'metadata (view pixels in the canvas)')
        .replace('an undoable edit', 'a revision-checked edit')
        + ' Operates on this browser tab’s local workspace. Image bytes are omitted; inspect the preview canvas for pixels.',
      inputSchema: {
        ...mcpToolJsonSchema(definition),
        ...(definition.shape.includePreview ? { properties: {
          ...(mcpToolJsonSchema(definition).properties as Record<string, unknown>),
          includePreview: { type: 'boolean', description: 'Render fresh output and return metadata; inspect pixels in the canvas.' },
        } } : {}),
      },
      annotations: { readOnlyHint: definition.readOnly, untrustedContentHint: true },
      execute: async (args, client) => {
        try {
          lifetime.signal.throwIfAborted();
          const signal = client?.signal ? AbortSignal.any([lifetime.signal, client.signal]) : lifetime.signal;
          signal.throwIfAborted();
          const result = await application.call(definition.name, mcpToolSchema(definition).parse(args), signal);
          return JSON.stringify(result);
        } catch (error) {
          return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
        }
      },
    };
    // Registration may be asynchronous. Dispose also covers registrations that
    // finish after unmount, including older navigator-based implementations.
    try {
      const registration = context.registerTool(tool, { signal: lifetime.signal });
      registered.add(tool.name);
      void Promise.resolve(registration).then(() => {
        if (lifetime.signal.aborted) {
          unregister(tool.name);
        }
      }).catch(() => {
        registered.delete(tool.name);
      });
    } catch {
      // A disabled permissions policy or unsupported schema must not break editing.
    }
  }
  return () => {
    lifetime.abort();
    for (const name of registered) {
      unregister(name);
    }
  };
}
