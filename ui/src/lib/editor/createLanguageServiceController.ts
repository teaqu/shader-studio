import type { Transport } from "../transport/MessageTransport";
import type * as Monaco from "monaco-editor/editor/editor.api.js";
import { setupMonacoLanguageServices } from "@shader-studio/monaco";
import { LanguageServiceController } from "./LanguageServiceController.svelte";
import { createLanguageServiceFactories } from "./createLanguageServiceFactories";
import { setRenameFeedback } from "../state/renameFeedback.svelte";

interface SharedManager {
  manager: ReturnType<typeof setupMonacoLanguageServices>;
  references: number;
}

const sharedManagers = new WeakMap<object, SharedManager>();

export function createLanguageServiceController(monaco: typeof Monaco, transport?: Transport): LanguageServiceController {
  let shared = sharedManagers.get(monaco);
  if (!shared) {
    shared = { manager: createManager(monaco, transport), references: 0 };
    sharedManagers.set(monaco, shared);
  }
  const sharedManager = shared;
  sharedManager.references += 1;

  let released = false;
  return new LanguageServiceController(shared.manager, () => {
    if (released) {
      return;
    }
    released = true;
    sharedManager.references -= 1;
    if (sharedManager.references === 0) {
      sharedManager.manager.dispose();
      sharedManagers.delete(monaco);
    }
  });
}

function createManager(monaco: typeof Monaco, transport?: Transport): ReturnType<typeof setupMonacoLanguageServices> {
  return setupMonacoLanguageServices(monaco, {
    ...createLanguageServiceFactories(),
  }, { onRenameFeedback: setRenameFeedback, applyWorkspaceEdit: transport?.applyWorkspaceEdit?.bind(transport), getWorkspaceDocuments: transport?.getWorkspaceDocuments?.bind(transport) });
}
