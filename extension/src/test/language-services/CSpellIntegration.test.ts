import * as assert from "assert";
import * as path from "path";
import type * as vscode from "vscode";
import { registerCSpellDictionary, type ExtensionLookup } from "../../language-services/CSpellIntegration";

suite("cSpell integration", () => {
  test("does nothing when Code Spell Checker is not installed", async () => {
    const context = { asAbsolutePath: (value: string) => path.resolve("/extension", value) } as vscode.ExtensionContext;
    const lookup: ExtensionLookup = { getExtension: () => undefined };

    assert.strictEqual(await registerCSpellDictionary(context, lookup), false);
  });

  test("registers the packaged dictionary with an installed Code Spell Checker", async () => {
    const registered: string[] = [];
    const context = { asAbsolutePath: (value: string) => path.resolve("/extension", value) } as vscode.ExtensionContext;
    const lookup: ExtensionLookup = {
      getExtension: () => ({
        activate: async () => ({
          registerConfig: async (configPath: string) => {
            registered.push(configPath);
          },
        }),
      }),
    };

    assert.strictEqual(await registerCSpellDictionary(context, lookup), true);

    assert.deepStrictEqual(registered, [path.resolve("/extension", "cspell-ext.json")]);
  });

  test("does nothing when an installed Code Spell Checker has no config API", async () => {
    const context = { asAbsolutePath: (value: string) => path.resolve("/extension", value) } as vscode.ExtensionContext;
    const lookup: ExtensionLookup = {
      getExtension: () => ({ activate: async () => ({}) }),
    };

    assert.strictEqual(await registerCSpellDictionary(context, lookup), false);
  });

  test("does not fail Shader Studio activation when Code Spell Checker rejects", async () => {
    const context = { asAbsolutePath: (value: string) => path.resolve("/extension", value) } as vscode.ExtensionContext;
    const lookup: ExtensionLookup = {
      getExtension: () => ({
        activate: async () => {
          throw new Error("cSpell failed");
        },
      }),
    };

    assert.strictEqual(await registerCSpellDictionary(context, lookup), false);
  });

  test("does not fail Shader Studio activation when dictionary registration rejects", async () => {
    const context = { asAbsolutePath: (value: string) => path.resolve("/extension", value) } as vscode.ExtensionContext;
    const lookup: ExtensionLookup = {
      getExtension: () => ({
        activate: async () => ({
          registerConfig: async () => {
            throw new Error("register failed");
          },
        }),
      }),
    };

    assert.strictEqual(await registerCSpellDictionary(context, lookup), false);
  });
});
