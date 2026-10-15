import * as vscode from 'vscode';
import * as fs from 'node:fs';
import type { ViewerCapture, ViewerSnapshot } from '@shader-studio/types';
import type { McpApplication } from './McpTools';
import type { Messenger } from '../transport/Messenger';
import type { ShaderProvider } from '../ShaderProvider';
import { getConfigPathForShaderPath } from '../ShaderConfigPaths';
import { resolveNewWorkspaceFile, resolveWorkspaceFile, textRevision } from './WorkspaceFiles';
import { mcpLogs } from './McpLogs';
import { mcpEditGuard } from './McpEditGuard';
import { McpAutomation, isAutomationOperation } from './McpAutomation';
import { McpRecordingArtifacts } from './McpRecordingArtifacts';

export class VscodeMcpApplication implements McpApplication {
  // Serialize mutations so two agents cannot both commit the same revision.
  private edits: Promise<unknown> = Promise.resolve();

  private readonly automation?: McpAutomation;

  constructor(private readonly messenger: Messenger, private readonly provider: ShaderProvider, artifactDirectory?: string) {
    if (artifactDirectory) {
      this.automation = new McpAutomation(messenger.previews, new McpRecordingArtifacts(artifactDirectory), path => this.readFile(path));
    }
  }

  async call(operation: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (operation === 'update_file') {
      const edit = this.edits.then(() => this.updateFile(args, signal));
      this.edits = edit.catch(() => undefined);
      return edit;
    }
    if (operation === 'create_file') {
      return this.createFile(args, signal);
    }
    if (signal.aborted) {
      throw new Error('Request cancelled.');
    }
    if (operation === 'read_recording_artifact') {
      if (!this.automation) {
        throw new Error('Recording storage is unavailable.');
      }
      return this.automation.readArtifact(String(args.id));
    }
    if (isAutomationOperation(operation)) {
      if (typeof args.previewId !== 'string') {
        throw new Error('An explicit previewId is required for automation.');
      }
      if (!this.automation) {
        throw new Error('Preview automation is unavailable.');
      }
      return this.automation.call(this.messenger.previews.select(args.previewId), operation, args, signal);
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
    if (operation === 'select_shader') {
      return this.selectShader(args, signal);
    }
    const id = this.messenger.previews.select(args.previewId as string | undefined);
    const state = await this.messenger.previews.request(id, 'get_state', {}, signal);
    if (operation === 'get_inputs') {
      if (!state.inputs) {
        throw new Error('This preview does not expose inputs. Reload the preview with the current extension.');
      }
      return { previewId: id, inputs: state.inputs };
    }
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

  private async selectShader(args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const id = this.messenger.previews.select(args.previewId as string | undefined);
    const current = await this.messenger.previews.request(id, 'get_state', {}, signal);
    const document = await this.openDocument(String(args.path));
    await this.messenger.previews.request(id, 'select_shader', { path: document.uri.fsPath, expectedPath: current.path }, signal);
    await this.provider.sendShaderFromDocument(document, { reload: true, previewId: id });
    const sequence = this.messenger.getCompileSequence(document.uri.fsPath);
    if (sequence === undefined) {
      throw new Error('No compilation was sent for the selected shader.');
    }
    const state = await this.messenger.previews.request(id, 'get_state', {
      requiredPath: document.uri.fsPath, requiredSequence: sequence,
    }, signal);
    return { previewId: id, selectedPath: document.uri.fsPath, previewPath: state.path, compileSequence: sequence };
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
    const id = this.updatePreviewId(args);
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
      if (state?.path) {
        mcpEditGuard.arm(document.uri.fsPath, args.text, state.path);
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(before.length)), args.text);
      if (!await vscode.workspace.applyEdit(edit)) {
        mcpEditGuard.clear(document.uri.fsPath);
        throw new Error('VS Code rejected the file edit.');
      }
    }
    const file = { path: document.uri.fsPath, editedPath: document.uri.fsPath, revision: textRevision(document.getText()), editedRevision: textRevision(document.getText()), dirty: document.isDirty };
    if (!id || !state?.path) {
      return { ...file, applied: true };
    }
    try {
      // Rebuild from the file-backed project, including edited passes, includes,
      // scripts and configs. Normal file events still update other previews.
      const shader = await this.openDocument(state.path);
      await this.provider.sendShaderFromDocument(shader, { previewId: id });
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

  private async createFile(args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (signal.aborted) {
      throw new Error('Request cancelled.');
    }
    if (typeof args.path !== 'string' || typeof args.text !== 'string' || args.text.length > 1_000_000 || args.text.includes('\0')) {
      throw new Error('Invalid file path or text content.');
    }
    if (!vscode.workspace.isTrusted) {
      throw new Error('Trust this local workspace before using MCP file tools.');
    }
    const roots = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath) ?? [];
    const resolved = resolveNewWorkspaceFile(args.path, roots);
    if (vscode.workspace.textDocuments.some(document => document.uri.fsPath === resolved)) {
      throw new Error('File already exists.');
    }
    if (signal.aborted) {
      throw new Error('Request cancelled.');
    }
    const uri = vscode.Uri.file(resolved);
    // Creating a .glsl file can report an empty document before the requested
    // insert. This path is never a preview selection.
    mcpEditGuard.armSuppression(resolved, args.text);
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
    if (args.text) {
      edit.insert(uri, new vscode.Position(0, 0), args.text);
    }
    if (!await vscode.workspace.applyEdit(edit)) {
      mcpEditGuard.clear(resolved);
      throw new Error('VS Code rejected the file create.');
    }
    const document = await vscode.workspace.openTextDocument(uri);
    return { path: document.uri.fsPath, revision: textRevision(document.getText()), dirty: document.isDirty, created: true };
  }

  private updatePreviewId(args: Record<string, unknown>): string | undefined {
    if (args.previewId !== undefined || args.includePreview === true) {
      return this.messenger.previews.select(args.previewId as string | undefined);
    }
    return this.messenger.previews.list().length === 1 ? this.messenger.previews.select() : undefined;
  }

  private async output(id: string, capture: boolean, payload: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const state = await this.messenger.previews.request(id, capture ? 'capture' : 'get_state', payload, signal);
    const { data, mimeType, ...metadata } = state as ViewerSnapshot & Partial<ViewerCapture>;
    return { previewId: id, ...metadata, ...(capture ? { image: { data, mimeType } } : {}) };
  }
}
