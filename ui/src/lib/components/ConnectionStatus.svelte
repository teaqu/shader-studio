<script lang="ts">
  import type { Transport } from "../transport/Transport";

  export let transport: Transport | null = null;

  $: connectionType = transport?.getType() || "unknown";
  $: isConnected = transport?.isConnected() || false;
  $: connectionStatus = isConnected ? "Connected" : "Disconnected";
  $: statusClass = isConnected ? "connected" : "disconnected";
</script>

<div class="connection-status {statusClass}">
  <div class="connection-indicator"></div>
  <span class="connection-text">
    {connectionType.toUpperCase()} - {connectionStatus}
  </span>
</div>

<style>
  .connection-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.1);
    font-size: 12px;
    font-weight: 500;
  }

  .connection-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    transition: background-color 0.3s ease;
  }

  .connected .connection-indicator {
    background-color: #4ade80; /* green-400 */
  }

  .disconnected .connection-indicator {
    background-color: #f87171; /* red-400 */
  }

  .connected {
    color: #22c55e; /* green-500 */
  }

  .disconnected {
    color: #ef4444; /* red-500 */
  }

  .connection-text {
    text-transform: capitalize;
  }
</style>
