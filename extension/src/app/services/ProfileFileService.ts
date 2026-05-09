import * as vscode from 'vscode';
import * as path from 'path';
import type { ProfileIndex, ProfileData } from '@shader-studio/types';

const PROFILES_DIR = '.shader-studio/profiles';

export class ProfileFileService {
  constructor(private workspaceRoot: string) {}

  private profilesDir(): string {
    return path.join(this.workspaceRoot, PROFILES_DIR);
  }

  private indexUri(): vscode.Uri {
    return vscode.Uri.file(path.join(this.profilesDir(), 'index.json'));
  }

  private profileUri(id: string): vscode.Uri {
    return vscode.Uri.file(path.join(this.profilesDir(), `${id}.json`));
  }

  async readIndex(): Promise<ProfileIndex | null> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.indexUri());
      return JSON.parse(Buffer.from(bytes).toString('utf-8')) as ProfileIndex;
    } catch {
      return null;
    }
  }

  async writeIndex(index: ProfileIndex): Promise<void> {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(this.profilesDir())
    );
    await vscode.workspace.fs.writeFile(
      this.indexUri(),
      Buffer.from(JSON.stringify(index, null, 2), 'utf-8')
    );
  }

  async readProfile(id: string): Promise<ProfileData | null> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.profileUri(id));
      return JSON.parse(Buffer.from(bytes).toString('utf-8')) as ProfileData;
    } catch {
      return null;
    }
  }

  async writeProfile(id: string, data: ProfileData): Promise<void> {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(this.profilesDir())
    );
    await vscode.workspace.fs.writeFile(
      this.profileUri(id),
      Buffer.from(JSON.stringify(data, null, 2), 'utf-8')
    );
  }

  async deleteProfile(id: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.profileUri(id));
    } catch {
      // file not found — nothing to delete
    }
  }
}
