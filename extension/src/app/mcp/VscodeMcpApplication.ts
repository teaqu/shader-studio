import * as vscode from 'vscode';
import * as fs from 'node:fs';
import type { ViewerCapture, ViewerSnapshot } from '@shader-studio/types';
import type { McpApplication } from './McpTools';
import type { Messenger } from '../transport/Messenger';
import type { ShaderProvider } from '../ShaderProvider';
import { getConfigPathForShaderPath } from '../ShaderConfigPaths';
import { resolveWorkspaceFile, textRevision } from './WorkspaceFiles';
import { mcpLogs } from './McpLogs';

export class VscodeMcpApplication implements McpApplication {
  // Serialize mutations so two agents cannot both commit the same revision.
  private edits: Promise<unknown> = Promise.resolve();

  constructor(private readonly messenger: Messenger, private readonly provider: ShaderProvider) {}

  async call(operation: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (operation === 'update_file') {
      const edit = this.edits.then(() => this.updateFile(args, signal));
      this.edits = edit.catch(() => undefined);
      return edit;
    }
    if (signal.aborted) {
      throw new Error('Request cancelled.');
    }
    if (operation === 'get_logs') {
      return mcpLogs.read(args);
    }
    if (operation === 'list_files') {
      const files = await vscode.workspace.findFiles(String(args.glob ?? '**/*'), '**/{.git,node_modules,dist,out}/**', 201);
      return { files: files.slice(0, 200).map(file => file.fsPath), truncated: files.length > 200 };
    }
    if (operation === 'read_file') {
      return this.readFile(String(args.path));
    }
    if (operation === 'list_previews') {
      return this.listPreviews(signal);
    }
    const id = this.messenger.previews.select(args.previewId as string | undefined);
    const state = await this.messenger.previews.request(id, 'get_state', {}, signal);
    if (operation === 'get_resources') {
      return { previewId: id, path: state.path, ...state.resources };
    }
    if (operation === 'read_storage') {
      return { previewId: id, ...await this.messenger.previews.request(id, 'read_storage', {
        expectedPath: state.path, name: args.name, start: args.start ?? 0, count: args.count ?? 16,
      }, signal) };
    }
    if (operation === 'get_shader') {
      if (!state.path) {
        throw new Error('No shader is loaded.');
      }
      return { previewId: id, ...await this.readFile(state.path), language: state.language };
    }
    if (operation === 'get_settings') {
      const configPath = getConfigPathForShaderPath(state.path);
      const configFile = state.path && configPath !== state.path && fs.existsSync(configPath)
        ? await this.readFile(configPath) : null;
      return { previewId: id, viewer: state, configFile };
    }
    if (operation === 'get_diagnostics') {
      return { previewId: id, ...state };
    }
    return this.controlOutput(id, operation, args, state.path, signal);
  }

  private async listPreviews(signal: AbortSignal): Promise<Record<string, unknown>> {
    const previews = await Promise.all(this.messenger.previews.list().map(async preview => {
      try {
        return { ...preview, ...await this.messenger.previews.request(preview.id, 'get_state', {}, signal) };
      } catch (error) {
        return { ...preview, error: String(error) };
      }
    }));
    return { previews };
  }

  private async controlOutput(id: string, operation: string, args: Record<string, unknown>, path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = { expectedPath: path };
    const control = operation === 'update_settings' ? 'settings' : operation === 'set_playback' ? 'playback' : undefined;
    if (control) {
      const keys = control === 'settings' ? ['fpsLimit', 'speed', 'uniforms'] : ['paused', 'reset', 'time'];
      for (const key of keys) {
        if (args[key] !== undefined) {
          payload[key] = args[key];
        }
      }
      await this.messenger.previews.request(id, control, payload, signal);
    } else if (operation !== 'capture_output') {
      throw new Error('Unknown MCP operation.');
    }
    return this.output(id, operation === 'capture_output' || args.includePreview === true, payload, signal);
  }

  private async readFile(filePath: string): Promise<Record<string, unknown>> {
    const document = await this.openDocument(filePath);
    const text = document.getText();
    if (text.length > 1_000_000 || text.includes('\0')) {
      throw new Error('File is not a supported text document (limit 1 MB).');
    }
    return { path: document.uri.fsPath, text, revision: textRevision(text), dirty: document.isDirty };
  }

  private async openDocument(filePath: string): Promise<vscode.TextDocument> {
    if (!vscode.workspace.isTrusted) {
      throw new Error('Trust this local workspace before using MCP file tools.');
    }
    const roots = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath) ?? [];
    const openFiles = vscode.workspace.textDocuments.filter(doc => doc.uri.scheme === 'file' && fs.existsSync(doc.uri.fsPath)).map(doc => doc.uri.fsPath);
    const resolved = resolveWorkspaceFile(filePath, roots, openFiles);
    return vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
  }

  private async updateFile(args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (signal.aborted) {
      throw new Error('Request cancelled.');
    }
    const id = args.previewId !== undefined || args.includePreview === true
      ? this.messenger.previews.select(args.previewId as string | undefined) : undefined;
    const state = id ? await this.messenger.previews.request(id, 'get_state', {}, signal) : undefined;
    const document = await this.openDocument(String(args.path));
    const before = document.getText();
    if (before.length > 1_000_000 || before.includes('\0')) {
      throw new Error('File is not a supported text document (limit 1 MB).');
    }
    if (textRevision(before) !== args.expectedRevision) {
      throw new Error('File changed since it was read. Call read_file and retry with its revision.');
    }
    if (typeof args.text !== 'string' || args.text.length > 1_000_000 || args.text.includes('\0')) {
      throw new Error('Invalid text content.');
    }
    if (signal.aborted) {
      throw new Error('Request cancelled.');
    }
    if (before !== args.text) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(before.length)), args.text);
      if (!await vscode.workspace.applyEdit(edit)) {
        throw new Error('VS Code rejected the file edit.');
      }
    }
    const file = { path: document.uri.fsPath, revision: textRevision(document.getText()), dirty: document.isDirty };
    if (!id || !state?.path) {
      return { ...file, applied: true };
    }
    try {
      // Rebuild from the file-backed project, including edited passes, includes,
      // scripts and configs. Normal file events still update other previews.
      const shader = await this.openDocument(state.path);
      await this.provider.sendShaderFromDocument(shader);
      const sequence = this.messenger.getCompileSequence(state.path);
      if (sequence === undefined) {
        throw new Error('No compilation was sent for this shader.');
      }
      const output = await this.output(id, args.includePreview === true, {
        expectedPath: state.path, requiredPath: state.path, requiredSequence: sequence,
      }, signal);
      return { ...output, ...file, applied: true, previewPath: state.path };
    } catch (error) {
      // The edit already happened: do not encourage retrying a successful edit.
      return { ...file, applied: true, previewError: error instanceof Error ? error.message : String(error) };
    }
  }

  private async output(id: string, capture: boolean, payload: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const state = await this.messenger.previews.request(id, capture ? 'capture' : 'get_state', payload, signal);
    const { data, mimeType, ...metadata } = state as ViewerSnapshot & Partial<ViewerCapture>;
    return { previewId: id, ...metadata, ...(capture ? { image: { data, mimeType } } : {}) };
  }
}
