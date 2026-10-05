<script lang="ts">
  interface Props { title: string; message: string }
  let { title, message }: Props = $props();
</script>

<div class="capture-error" role="alert">
  <i class="codicon codicon-error" aria-hidden="true"></i>
  <div>
    <strong>{title}</strong>
    <p>{message}</p>
  </div>
</div>

<style>
  .capture-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    border-left-width: 3px;
    border-radius: 4px;
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    color: var(--vscode-inputValidation-errorForeground, #ffffff);
    font-size: 12px;
    line-height: 1.5;
  }
  i { flex-shrink: 0; margin-top: 2px; font-size: 16px; }
  strong { display: block; margin-bottom: 2px; }
  p { margin: 0; overflow-wrap: anywhere; }
</style>
