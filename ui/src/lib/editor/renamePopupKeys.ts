import type { editor } from "monaco-editor";

/** Monaco's keybinding listener does not cover externally hosted overflow widgets. */
export function bindRenamePopupKeys(container: HTMLElement, owner: Pick<editor.IStandaloneCodeEditor, "trigger">): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    if (!(event.target instanceof HTMLInputElement) || !event.target.closest(".rename-box")) {
      return;
    }
    const command = event.key === "Enter" ? "acceptRenameInput" : event.key === "Escape" ? "cancelRenameInput" : null;
    if (!command) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    owner.trigger("keyboard", command, undefined);
  };
  container.addEventListener("keydown", onKeyDown);
  return () => container.removeEventListener("keydown", onKeyDown);
}
