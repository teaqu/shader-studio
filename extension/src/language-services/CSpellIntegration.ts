import * as vscode from "vscode";

interface CSpellApi {
  registerConfig?(configPath: string): Promise<void> | void;
}

export interface ExtensionLookup {
  getExtension(extensionId: string): { activate(): PromiseLike<CSpellApi> } | undefined;
}

const vscodeExtensionLookup: ExtensionLookup = {
  getExtension: extensionId => vscode.extensions.getExtension<CSpellApi>(extensionId),
};

export async function registerCSpellDictionary(
  context: vscode.ExtensionContext,
  extensions: ExtensionLookup = vscodeExtensionLookup,
): Promise<boolean> {
  const extension = extensions.getExtension("streetsidesoftware.code-spell-checker");
  if (!extension) {
    return false;
  }
  try {
    const api = await extension.activate();
    if (!api.registerConfig) {
      return false;
    }
    await api.registerConfig(context.asAbsolutePath("cspell-ext.json"));
    return true;
  } catch {
    return false;
  }
}
