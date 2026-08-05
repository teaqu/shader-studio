import type {
  ComputePass,
  ShaderConfig,
  StorageBufferConfig,
} from '@shader-studio/types';

export type ConfigFieldErrors = Record<string, string>;

export type ConfigMutationResult =
  | { ok: true; config: ShaderConfig }
  | { ok: false; errors: ConfigFieldErrors };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_STORAGE_NAMES = new Set(['Image', 'common', 'Common', 'Script', 'Storage']);
const MAX_DISPATCH_COUNT = 1024;
const MAX_OUTPUT_LAYERS = 8;
const MAX_TOTAL_STORAGE_BYTES = 256 * 1024 * 1024;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function validateComputePass(
  config: ShaderConfig,
  passName: string,
  pass: ComputePass,
): ConfigFieldErrors {
  const errors: ConfigFieldErrors = {};
  const workgroup = pass.workgroupSize;

  if (workgroup?.some((value) => !isPositiveInteger(value))) {
    errors.workgroupSize = 'Workgroup dimensions must be positive integers';
  }

  if (pass.dispatchCount !== undefined && (
    !isPositiveInteger(pass.dispatchCount) || pass.dispatchCount > MAX_DISPATCH_COUNT
  )) {
    errors.dispatchCount = 'Repeats must be an integer from 1 through 1024';
  }
  if (pass.dispatchOnce && (pass.dispatchCount ?? 1) > 1) {
    errors.dispatchOnce = 'Run once cannot be combined with repeats greater than 1';
  }
  if (pass.outputLayers !== undefined && (
    !isPositiveInteger(pass.outputLayers) || pass.outputLayers > MAX_OUTPUT_LAYERS
  )) {
    errors.outputLayers = 'Output layers must be an integer from 1 through 8';
  }

  const dispatch = pass.dispatch;
  if (dispatch && 'count' in dispatch && !isPositiveInteger(dispatch.count ?? Number.NaN)) {
    errors.dispatch = 'Element count must be a positive integer';
  } else if (dispatch && 'x' in dispatch && (
    !isPositiveInteger(dispatch.x ?? Number.NaN)
    || !isPositiveInteger(dispatch.y ?? Number.NaN)
    || !isPositiveInteger(dispatch.z ?? Number.NaN)
  )) {
    errors.dispatch = 'Raw workgroup axes must be positive integers';
  } else if (dispatch && 'cover' in dispatch) {
    const storageNames = new Set(Object.keys(config.storage ?? {}));
    const channelNames = new Set(Object.keys(pass.inputs ?? {}));
    const cover = dispatch.cover ?? '';
    if (!storageNames.has(cover) && !channelNames.has(cover)) {
      errors.dispatch = `Cover target "${cover}" is not a storage buffer or input on ${passName}`;
    }
  }

  return errors;
}

function nextStorageName(storage: ShaderConfig['storage']): string {
  const existing = new Set(Object.keys(storage ?? {}));
  for (let index = 0; index < 26; index += 1) {
    const name = `storage${String.fromCharCode(65 + index)}`;
    if (!existing.has(name)) {
      return name;
    }
  }
  let suffix = 1;
  while (existing.has(`storage${suffix}`)) {
    suffix += 1;
  }
  return `storage${suffix}`;
}

export function addStorageBuffer(config: ShaderConfig): { config: ShaderConfig; name: string } {
  const name = nextStorageName(config.storage);
  return {
    name,
    config: {
      ...config,
      storage: {
        ...config.storage,
        [name]: { count: 1024, stride: 16, elementType: 'float4' },
      },
    },
  };
}

function validateStorageBuffer(
  config: ShaderConfig,
  originalName: string | null,
  name: string,
  declaration: StorageBufferConfig,
): ConfigFieldErrors {
  const errors: ConfigFieldErrors = {};
  if (!IDENTIFIER.test(name)) {
    errors.name = 'Invalid storage buffer name';
  } else if (RESERVED_STORAGE_NAMES.has(name)) {
    errors.name = 'Storage buffer name is reserved';
  } else if (name !== originalName && config.storage?.[name]) {
    errors.name = 'Storage buffer name is already in use';
  }
  if (!isPositiveInteger(declaration.count)) {
    errors.count = 'Element count must be a positive integer';
  }
  if (!isPositiveInteger(declaration.stride)) {
    errors.stride = 'Byte stride must be a positive integer';
  }
  if (declaration.elementType.trim().length === 0) {
    errors.elementType = 'Element type is required';
  }

  if (isPositiveInteger(declaration.count) && isPositiveInteger(declaration.stride)) {
    const bytes = declaration.count * declaration.stride;
    if (!Number.isSafeInteger(bytes)) {
      errors.count = 'Count multiplied by stride must be a safe integer';
    } else {
      const otherBytes = Object.entries(config.storage ?? {})
        .filter(([existingName]) => existingName !== originalName)
        .reduce((sum, [, item]) => sum + item.count * item.stride, 0);
      if (otherBytes + bytes > MAX_TOTAL_STORAGE_BYTES) {
        errors.count = 'Total storage allocation must not exceed 256 MiB';
      }
    }
  }
  return errors;
}

export function applyStorageBuffer(
  config: ShaderConfig,
  originalName: string | null,
  name: string,
  declaration: StorageBufferConfig,
): ConfigMutationResult {
  const errors = validateStorageBuffer(config, originalName, name, declaration);
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const nextStorage: Record<string, StorageBufferConfig> = {};
  let inserted = false;
  for (const [existingName, existingDeclaration] of Object.entries(config.storage ?? {})) {
    if (existingName === originalName) {
      nextStorage[name] = { ...declaration, elementType: declaration.elementType.trim() };
      inserted = true;
    } else {
      nextStorage[existingName] = existingDeclaration;
    }
  }
  if (!inserted) {
    nextStorage[name] = { ...declaration, elementType: declaration.elementType.trim() };
  }

  const nextPasses = { ...config.passes };
  if (originalName && originalName !== name) {
    for (const [passName, passConfig] of Object.entries(nextPasses)) {
      if (!passName.startsWith('Compute') || !passConfig) {
        continue;
      }
      const computePass = passConfig as ComputePass;
      if (computePass.dispatch && 'cover' in computePass.dispatch && computePass.dispatch.cover === originalName) {
        nextPasses[passName] = { ...computePass, dispatch: { cover: name } };
      }
    }
  }

  return {
    ok: true,
    config: { ...config, storage: nextStorage, passes: nextPasses },
  };
}

export function getStorageCoverReferences(config: ShaderConfig, name: string): string[] {
  return Object.entries(config.passes)
    .filter(([passName, passConfig]) => {
      if (!passName.startsWith('Compute') || !passConfig) {
        return false;
      }
      const dispatch = (passConfig as ComputePass).dispatch;
      return dispatch && 'cover' in dispatch && dispatch.cover === name;
    })
    .map(([passName]) => passName);
}

export function removeStorageBuffer(config: ShaderConfig, name: string): ConfigMutationResult {
  const references = getStorageCoverReferences(config, name);
  if (references.length > 0) {
    return {
      ok: false,
      errors: { name: `Used as a dispatch target by ${references.join(', ')}` },
    };
  }
  if (!config.storage?.[name]) {
    return { ok: false, errors: { name: 'Storage buffer was not found' } };
  }
  const nextStorage = { ...config.storage };
  delete nextStorage[name];
  return {
    ok: true,
    config: {
      ...config,
      storage: Object.keys(nextStorage).length > 0 ? nextStorage : undefined,
    },
  };
}
