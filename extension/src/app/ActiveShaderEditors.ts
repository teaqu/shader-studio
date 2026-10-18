import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { TabGroupResolver } from './TabGroupResolver';

interface PreviewFiles {
  shaderPath: string;
  files: string[];
  column?: vscode.ViewColumn;
}

/** Keeps shader tabs aligned with live preview file sets. Native close handles dirty files. */
export class ActiveShaderEditors {
  private previews = new Map<object, PreviewFiles>();
  private managed = new Set<vscode.Tab>();
  private retained = new Set<vscode.Tab>();
  private queue = Promise.resolve();
  private version = 0;
  private enabled = false;
  private disposed = false;
  private managing = false;

  get isManaging(): boolean {
    return this.managing;
  }

  setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    return this.schedule();
  }

  update(preview: object, payload: unknown): Promise<void> {
    const value = payload as { shaderPath?: unknown; files?: unknown } | undefined;
    if (typeof value?.shaderPath !== 'string' || !path.isAbsolute(value.shaderPath) || !Array.isArray(value.files)) {
      return Promise.resolve();
    }
    const shaderPath = value.shaderPath;
    const files = [shaderPath, ...value.files.filter((file): file is string => typeof file === 'string' && path.isAbsolute(file))];
    const previous = this.previews.get(preview);
    this.previews.set(preview, { shaderPath, files: [...new Set(files)].filter(file => fs.existsSync(file)), column: previous?.column });
    return this.schedule();
  }

  remove(preview: object): Promise<void> {
    this.previews.delete(preview);
    return this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    this.version++;
    this.previews.clear();
    this.managed.clear();
    this.retained.clear();
  }

  private schedule(): Promise<void> {
    const version = ++this.version;
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (!this.enabled || this.disposed || version !== this.version) {
        return;
      }
      this.managing = true;
      try {
        await this.reconcile(version);
      } finally {
        this.managing = false;
      }
    });
    return this.queue;
  }

  private async reconcile(version: number): Promise<void> {
    if (this.previews.size === 0 && this.managed.size === 0) {
      return;
    }
    const nextTabs = new Set<vscode.Tab>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText && /\.(glsl|frag|vert|slang|wgsl|sha\.json)$/i.test(tab.input.uri.fsPath)) {
          this.managed.add(tab);
        }
      }
    }
    const usedColumns = new Set([...this.previews.values()].map(preview => preview.column).filter(column => column !== undefined));
    for (const preview of this.previews.values()) {
      const groups = vscode.window.tabGroups.all;
      if (!groups.some(group => group.viewColumn === preview.column)) {
        const available = groups.find(group => !TabGroupResolver.groupHasExtensionPanel(group) && !usedColumns.has(group.viewColumn));
        preview.column = available?.viewColumn ?? vscode.ViewColumn.Beside;
      }
      // Open the root last so linked buffers do not become the selected editor.
      const files = [...preview.files.filter(file => file !== preview.shaderPath), preview.shaderPath];
      for (const file of files) {
        if (version !== this.version) {
          return;
        }
        let tab = this.findTab(file, preview.column);
        if (!tab) {
          try {
            const editor = await vscode.window.showTextDocument(vscode.Uri.file(file), {
              viewColumn: preview.column, preview: false, preserveFocus: true,
            });
            preview.column = editor.viewColumn;
            if (preview.column !== undefined) {
              usedColumns.add(preview.column);
            }
            tab = this.findTab(file, preview.column);
          } catch {
            // A missing or unreadable source must not prevent the other files opening.
            continue;
          }
        }
        if (tab) {
          nextTabs.add(tab);
          this.retained.delete(tab);
          this.managed.add(tab);
        }
      }
    }
    for (const tab of this.managed) {
      if (version !== this.version) {
        return;
      }
      const file = tab.input instanceof vscode.TabInputText ? tab.input.uri.fsPath : undefined;
      if (!nextTabs.has(tab) && !this.retained.has(tab) && file
        && vscode.window.tabGroups.all.some(group => group.tabs.includes(tab))) {
        // VS Code prompts Save / Don't Save / Cancel. A cancelled tab is retained.
        try {
          if (!await vscode.window.tabGroups.close(tab, true)) {
            this.retained.add(tab);
          }
        } catch {
          this.retained.add(tab);
        }
      }
    }
    this.managed = nextTabs;
  }

  private findTab(file: string, column: vscode.ViewColumn | undefined): vscode.Tab | undefined {
    return vscode.window.tabGroups.all.find(group => group.viewColumn === column)?.tabs.find(tab =>
      tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === file);
  }
}
