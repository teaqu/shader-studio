<svelte:options runes={true} />

<script lang="ts">
  import {
    configuredStorageLayout,
    storageStructDeclaration,
    validateStorageOptions,
    type StorageBufferConfig,
  } from "@shader-studio/types";
  import type { ConfigFieldErrors } from "../../config/ComputeConfigMutations";
  import { getBuiltinStorageStride } from "../../config/StorageTypeLayout";
  interface Props {
    name: string;
    declaration: StorageBufferConfig;
    existingNames: string[];
    referencedBy: string[];
    language?: "wgsl" | "slang" | "glsl";
    passes?: Array<{ name: string; compute: boolean }>;
    onApply: (
      originalName: string,
      name: string,
      declaration: StorageBufferConfig,
    ) => ConfigFieldErrors;
    onDelete: (name: string) => ConfigFieldErrors;
    onDeleted?: () => void;
    onRenamed?: (name: string) => void;
    onReset?: (name: string) => Promise<void>;
  }
  let {
    name,
    declaration,
    existingNames,
    referencedBy,
    language = "wgsl",
    passes = [],
    onApply,
    onDelete,
    onDeleted = () => {},
    onRenamed = () => {},
    onReset,
  }: Props = $props();
  const id = $props.id();
  let draftName = $state("");
  let count = $state("");
  let draft = $state<StorageBufferConfig>({ count: 1, elementType: "float4" });
  let errors = $state<ConfigFieldErrors>({});
  let resetting = $state(false);
  let status = $state("");
  $effect(() => {
    draftName = name;
    count = String(declaration.count);
    draft = structuredClone($state.snapshot(declaration));
    errors = {};
  });
  const layout = $derived(configuredStorageLayout(draft));
  const stride = $derived(
    layout?.stride ?? getBuiltinStorageStride(draft.elementType),
  );
  const dirty = $derived(
    draftName !== name ||
      count !== String(declaration.count) ||
      JSON.stringify(draft) !== JSON.stringify(declaration),
  );
  const fieldTypes = [
    "float",
    "float2",
    "float3",
    "float4",
    "int",
    "int2",
    "int3",
    "int4",
    "uint",
    "uint2",
    "uint3",
    "uint4",
  ];
  const mode = $derived(draft.fields ? "struct" : "source");
  function apply(): void {
    const next: StorageBufferConfig = {
      ...$state.snapshot(draft),
      count: Number(count),
      elementType: draft.elementType.trim(),
    };
    const validation: ConfigFieldErrors = {};
    if (!/^[A-Za-z_]\w*$/.test(draftName)) {
      validation.name = "Use a valid shader identifier";
    } else if (draftName !== name && existingNames.includes(draftName)) {
      validation.name = "Storage buffer name is already in use";
    }
    if (!Number.isSafeInteger(next.count) || next.count <= 0) {
      validation.count = "Enter a positive integer";
    }
    if (!next.elementType) {
      validation.elementType = "Element type is required";
    }
    const optionErrors = validateStorageOptions(next);
    if (optionErrors.length) {
      validation.layout = optionErrors.join("; ");
    }
    errors = validation;
    if (Object.keys(errors).length) {
      return;
    }
    errors = onApply(name, draftName, next);
    if (!Object.keys(errors).length) {
      onRenamed(draftName);
    }
  }
  function cancel(): void {
    draftName = name;
    count = String(declaration.count);
    draft = structuredClone($state.snapshot(declaration));
    errors = {};
  }
  function changeLayout(value: string): void {
    if (value === "struct") {
      draft.fields = [
        { name: "position", type: "float4" },
        { name: "velocity", type: "float4" },
      ];
      draft.elementType = `${name}_Element`;
    } else {
      delete draft.fields;
      draft.elementType = "float4";
    }
  }
  async function importData(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      if (file.size > 262144) {
        throw new Error("Initial data files must be at most 256 KiB");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = "";
      for (const byte of bytes) {
        text += String.fromCharCode(byte);
      }
      draft.initialData = btoa(text);
      draft.initialDataName = file.name;
      errors = {};
    } catch (reason) {
      errors = {
        initialData: reason instanceof Error ? reason.message : String(reason),
      };
    }
    input.value = "";
  }
  async function reset(): Promise<void> {
    if (!onReset || resetting) {
      return;
    }
    resetting = true;
    status = "";
    try {
      await onReset(name);
      status = "Data reset to initial values";
    } catch (reason) {
      errors = {
        reset: reason instanceof Error ? reason.message : String(reason),
      };
    } finally {
      resetting = false;
    }
  }
  function remove(): void {
    errors = onDelete(name);
    if (!Object.keys(errors).length) {
      onDeleted();
    }
  }
</script>

<article class="storage-editor" data-storage-name={name}>
  <section>
    <div class="heading">
      <h3>{name}</h3>
      {#if stride !== null}<span
          >{((Number(count) * stride) / 1024).toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })} KiB</span
        >{/if}
    </div>
    <div class="fields">
      <label
        >Buffer name<input
          aria-label="Storage name"
          aria-invalid={!!errors.name}
          bind:value={draftName}
        /></label
      ><label
        >Number of elements<input
          aria-label="Element count"
          aria-invalid={!!errors.count}
          bind:value={count}
          inputmode="numeric"
        /></label
      >
    </div>
  </section>
  <section>
    <div class="heading">
      <h3>Data layout</h3>
      <select
        aria-label="Data layout"
        value={mode}
        onchange={(event) => changeLayout(event.currentTarget.value)}
        ><option value="source">Value / source type</option><option
          value="struct">Structured data</option
        ></select
      >
    </div>
    <label
      >{draft.fields ? "Struct type" : "Element type"}<input
        aria-label="Element type"
        aria-invalid={!!errors.elementType}
        bind:value={draft.elementType}
      /></label
    >
    {#if draft.fields}<div class="schema">
        {#each draft.fields as field, index}<div>
            <label
              >Field<input
                aria-label="Field {index + 1} name"
                bind:value={field.name}
              /></label
            ><label
              >Type<input
                list={`${id}-types`}
                aria-label="Field {index + 1} type"
                bind:value={field.type}
              /></label
            ><button
              aria-label="Remove field {index + 1}"
              disabled={draft.fields.length === 1}
              onclick={() => draft.fields?.splice(index, 1)}>×</button
            >
          </div>{/each}
      </div>
      <datalist id={`${id}-types`}
        >{#each fieldTypes as type}<option value={type}
          ></option>{/each}</datalist
      ><button
        disabled={draft.fields.length >= 64}
        onclick={() =>
          draft.fields?.push({
            name: `field${draft.fields.length + 1}`,
            type: "float",
          })}>+ Add field</button
      >{/if}
    <p class="meta">
      {stride === null
        ? "Stride inferred from struct definition in source"
        : `Stride: ${stride} bytes · alignment handled automatically`}
    </p>
    <details>
      <summary
        >Shader declaration · {language === "slang" ? "Slang" : "WGSL"}</summary
      >
      <pre>{storageStructDeclaration(
          draft,
          language === "slang" ? "slang" : "wgsl",
        )}{draft.fields
          ? ""
          : `// Element type: ${draft.elementType}\n`}// Buffer: {draftName}</pre>
    </details>
    {#if draft.fields}<p class="meta">
        This struct is generated from the config. Use a different name from
        structs already declared in your source.
      </p>{/if}
  </section>
  <section>
    <h3>Pass bindings</h3>
    {#each passes as pass}<div class="pass">
        <span>{pass.name}</span><span
          >{pass.compute ? "Read & write" : "Read only"}</span
        >
      </div>{/each}
    <p class="meta">
      Storage is shared by all WebGPU passes. Shader source determines which
      buffers a pass uses.
    </p>
    {#if referencedBy.length}<p class="meta">
        Dispatch target for {referencedBy.join(", ")}
      </p>{/if}
  </section>
  <section>
    <h3>Initial data & reset</h3>
    <div class="fields">
      <label
        >Start with<select
          aria-label="Initial data"
          value={draft.initialData === undefined ? "zero" : "file"}
          onchange={(event) => {
            if (event.currentTarget.value === "zero") {
              delete draft.initialData;
              delete draft.initialDataName;
            } else {
              draft.initialData = "";
            }
          }}
          ><option value="zero">Zeros</option><option value="file"
            >Binary file</option
          ></select
        ></label
      ><label
        >Between frames<select
          aria-label="Between frames"
          value={draft.clearEachFrame ? "clear" : "keep"}
          onchange={(event) => {
            if (event.currentTarget.value === "clear") {
              draft.clearEachFrame = true;
            } else {
              delete draft.clearEachFrame;
            }
          }}
          ><option value="keep">Keep previous values</option><option
            value="clear">Clear every frame</option
          ></select
        ></label
      >
    </div>
    {#if draft.initialData !== undefined}<label
        >Initial data file<input
          type="file"
          aria-label="Initial data file"
          onchange={importData}
        /></label
      >
      <p class="meta">
        {draft.initialDataName ?? "Choose a binary file"} · up to 256 KiB, embedded
        in config. Unfilled bytes start at zero.
      </p>{/if}
    <label class="check"
      ><input
        type="checkbox"
        aria-label="Reset on restart"
        checked={draft.resetOnRestart !== false}
        onchange={(event) => {
          if (event.currentTarget.checked) {
            delete draft.resetOnRestart;
          } else {
            draft.resetOnRestart = false;
          }
        }}
      />Reset when the shader restarts</label
    >
    <div class="actions">
      {#if onReset}<button onclick={reset} disabled={dirty || resetting}
          >{resetting ? "Resetting…" : "Reset data now"}</button
        >{/if}<button
        aria-label="Delete {name}"
        onclick={remove}
        disabled={referencedBy.length > 0}>Remove buffer</button
      >
    </div>
    {#if referencedBy.length}<p class="meta">
        Remove its dispatch references before deleting this buffer.
      </p>{/if}
    {#if status}<p role="status">{status}</p>{/if}
  </section>
  {#each Object.values(errors) as error}<p role="alert">{error}</p>{/each}
  {#if dirty}<div class="actions">
      <button class="primary" aria-label="Apply {name} changes" onclick={apply}
        >Apply changes</button
      ><button aria-label="Cancel {name} changes" onclick={cancel}
        >Cancel</button
      >
    </div>
    <p class="meta">
      Applying a layout, size, or initial data change recreates the buffer.
    </p>{/if}
</article>

<style>
  .storage-editor {
    display: grid;
    gap: 20px;
    min-width: 0;
  }
  section {
    display: grid;
    gap: 14px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--storage-line);
  }
  section:last-of-type {
    border-bottom: 0;
    padding-bottom: 0;
  }
  .heading,
  .actions,
  .pass {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  h3,
  p {
    margin: 0;
  }
  h3 {
    font-size: 14px;
    font-weight: 500;
  }
  .fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
  }
  label {
    display: grid;
    gap: 6px;
    font-size: 12px;
    color: var(--storage-muted, var(--vscode-descriptionForeground));
  }
  input,
  select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    font-size: 14px;
  }
  .heading select {
    width: auto;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--storage-text, var(--vscode-foreground));
  }
  .check input {
    width: auto;
    min-height: 0;
    accent-color: var(--storage-accent);
  }
  .schema {
    display: grid;
    border: 1px solid var(--storage-line);
    border-radius: 7px;
    overflow: hidden;
  }
  .schema > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px;
    gap: 8px;
    align-items: end;
    padding: 10px;
    border-bottom: 1px solid var(--storage-line);
  }
  .schema > div:last-child {
    border-bottom: 0;
  }
  .schema button {
    border: 0;
    background: transparent;
    padding: 6px;
  }
  .pass {
    padding: 10px 0;
    border-bottom: 1px solid var(--storage-line);
  }
  .meta,
  .heading span,
  .pass span:last-child,
  summary {
    font-size: 12px;
    color: var(--storage-muted, var(--vscode-descriptionForeground));
  }
  summary {
    cursor: pointer;
  }
  .actions {
    justify-content: flex-start;
  }
  pre {
    margin: 12px 0 0;
    padding: 12px;
    background: var(--storage-soft);
    border-radius: 6px;
    font: 12px/1.7 var(--vscode-editor-font-family, monospace);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  p[role="alert"] {
    color: var(--vscode-errorForeground);
    font-size: 12px;
  }
  @container (max-width: 420px) {
    .fields {
      grid-template-columns: 1fr;
    }
  }
</style>
