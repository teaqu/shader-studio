<script lang="ts">
  import { DEFAULT_VERTEX_COUNT, DEFAULT_VERTEX_TOPOLOGY, DEFAULT_VERTEX_SPACE, MAX_VERTEX_COUNT, type VerticesGeometryConfig } from '@shader-studio/types';
  interface Props { bufferName: string; geometry: VerticesGeometryConfig; vertexCountError: string | null; onVertexCountChange: (event: Event) => void; onTopologyChange: (event: Event) => void; onSpaceChange: (event: Event) => void; }
  let { bufferName, geometry, vertexCountError, onVertexCountChange, onTopologyChange, onSpaceChange }: Props = $props();
</script>
          <div class="resolution-row">
            <label class="resolution-label" for="vertex-count-{bufferName}">Vertices</label>
            <input
              id="vertex-count-{bufferName}"
              class="vertex-count-input"
              type="number"
              min="1"
              max={MAX_VERTEX_COUNT}
              step="1"
              placeholder={String(DEFAULT_VERTEX_COUNT)}
              value={geometry.vertexCount ?? ''}
              onchange={onVertexCountChange}
            />
          </div>
          {#if vertexCountError}<span class="input-note" role="alert">{vertexCountError}</span>{/if}
          <div class="resolution-row">
            <label class="resolution-label" for="topology-{bufferName}">Topology</label>
            <select
              id="topology-{bufferName}"
              value={geometry.topology ?? DEFAULT_VERTEX_TOPOLOGY}
              onchange={onTopologyChange}
            >
              <option value="triangle-list">Triangle list</option>
              <option value="triangle-strip">Triangle strip</option>
              <option value="line-list">Line list</option>
              <option value="line-strip">Line strip</option>
              <option value="point-list">Point list</option>
            </select>
          </div>
          <div class="resolution-row">
            <label class="resolution-label" for="space-{bufferName}">Space</label>
            <select
              id="space-{bufferName}"
              value={geometry.space ?? DEFAULT_VERTEX_SPACE}
              onchange={onSpaceChange}
            >
              <option value="world">World (orbit camera)</option>
              <option value="clip">Clip (screen)</option>
            </select>
          </div>

<style>
  .resolution-row { display: flex; align-items: center; gap: 8px; }
  .resolution-label { min-width: 72px; font-size: 12px; }
  select, input { flex: 1; min-width: 0; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, #555); border-radius: 3px; padding: 4px 6px; font-size: 12px; }
  .input-note { font-size: 11px; color: var(--vscode-descriptionForeground); }
</style>
