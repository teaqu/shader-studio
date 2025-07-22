<script lang="ts">
  export let errors: string[] = [];
  export let isVisible: boolean = false;
  
  export let onDismiss: () => void = () => {};
  
  function handleDismiss() {
    onDismiss();
  }
</script>

{#if isVisible && errors.length > 0}
  <div class="error-overlay">
    <div class="error-content">
      <h3>Error</h3>
      {#each errors as error}
        <p class="error-message">{error}</p>
      {/each}
      <button class="error-dismiss" on:click={handleDismiss}>Dismiss</button>
    </div>
  </div>
{/if}
