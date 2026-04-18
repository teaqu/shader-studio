<script lang="ts">
  interface Props {
    errors?: string[];
    isVisible?: boolean;
    onDismiss?: () => void;
  }

  let {
    errors = [] as string[],
    isVisible = false,
    onDismiss = () => {},
  }: Props = $props();
</script>

{#if isVisible && errors.length > 0}
  <div class="error-overlay">
    <div class="error-content">
      <h3>Error</h3>
      {#each errors as error}
        <p class="error-message">{error}</p>
      {/each}
      <button class="error-dismiss" onclick={onDismiss}>Dismiss</button>
    </div>
  </div>
{/if}
