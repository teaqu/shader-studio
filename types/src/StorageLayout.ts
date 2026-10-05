import type { StorageBufferConfig } from './ShaderConfig';
import type { StorageFieldLayout } from './StorageInspection';
import { wgslStorageElementType } from './wgslStorage';

export interface StorageValueLayout {
  kind: 'float' | 'half' | 'int' | 'uint';
  columns: number;
  bytes: number;
  size: number;
  alignment: number;
  stride: number;
}

export function storageValueLayout(elementType: string): StorageValueLayout | null {
  if (typeof elementType !== 'string') {
    return null;
  }
  const type = wgslStorageElementType(elementType.trim(), 'compute').replace(/\s+/g, '');
  const vector = /^vec([2-4])<(f16|f32|i32|u32)>$/.exec(type);
  const alias = /^vec([2-4])([fhiu])$/.exec(type);
  const scalar = /^(f16|f32|i32|u32)$/.exec(type)?.[1]
    ?? /^atomic<(i32|u32)>$/.exec(type)?.[1]
    ?? vector?.[2]
    ?? ({ f: 'f32', h: 'f16', i: 'i32', u: 'u32' } as Record<string, string>)[alias?.[2] ?? ''];
  if (!scalar) {
    return null;
  }
  const columns = Number(vector?.[1] ?? alias?.[1] ?? 1);
  const bytes = scalar === 'f16' ? 2 : 4;
  const alignment = (columns === 3 ? 4 : columns) * bytes;
  const size = columns * bytes;
  return {
    kind: scalar === 'f16' ? 'half' : scalar === 'f32' ? 'float' : scalar === 'i32' ? 'int' : 'uint',
    columns, bytes, size, alignment, stride: Math.ceil(size / alignment) * alignment,
  };
}

export function configuredStorageLayout(config: StorageBufferConfig): { stride: number; fields: StorageFieldLayout[] } | null {
  if (!config || (config.fields !== undefined && !Array.isArray(config.fields))) {
    return null;
  }
  if (!config.fields) {
    const value = storageValueLayout(config.elementType);
    return value ? { stride: value.stride, fields: [{ name: 'value', type: config.elementType, offset: 0 }] } : null;
  }
  if (!config.fields.length || config.fields.length > 64) {
    return null;
  }
  let offset = 0;
  let alignment = 1;
  const fields: StorageFieldLayout[] = [];
  for (const field of config.fields) {
    const value = field ? storageValueLayout(field.type) : null;
    if (!value) {
      return null;
    }
    offset = Math.ceil(offset / value.alignment) * value.alignment;
    fields.push({ name: field.name, type: field.type, offset });
    offset += value.size;
    alignment = Math.max(alignment, value.alignment);
  }
  return { stride: Math.ceil(offset / alignment) * alignment, fields };
}

export function slangStorageFieldType(type: string): string {
  const value = storageValueLayout(type);
  if (!value) {
    return type;
  }
  const scalar = { float: 'float', half: 'half', int: 'int', uint: 'uint' }[value.kind];
  if (/^(?:atomic|Atomic)\s*</.test(type.trim())) {
    return `Atomic<${scalar}>`;
  }
  return value.columns === 1 ? scalar : scalar + value.columns;
}

export function storageStructDeclaration(config: StorageBufferConfig, language: 'wgsl' | 'slang'): string {
  if (!config.fields) {
    return '';
  }
  const fields = config.fields.map(field => language === 'wgsl'
    ? `  ${field.name}: ${wgslStorageElementType(field.type, 'compute')},`
    : `  ${slangStorageFieldType(field.type)} ${field.name};`);
  return `struct ${config.elementType} {\n${fields.join('\n')}\n}${language === 'slang' ? ';' : ''}\n`;
}

function validateFields(config: StorageBufferConfig): string[] {
  const errors: string[] = [];
  if (config.fields !== undefined) {
    if (!Array.isArray(config.fields) || !config.fields.length || config.fields.length > 64) {
      errors.push('Structured data needs between 1 and 64 fields');
    } else {
      const names = new Set<string>();
      for (const field of config.fields) {
        if (!field || typeof field.name !== 'string' || !/^[A-Za-z_]\w*$/.test(field.name) || names.has(field.name)) {
          errors.push('Field names must be unique shader identifiers');
        }
        if (!field || typeof field.type !== 'string' || !storageValueLayout(field.type)) {
          errors.push('Fields must use numeric scalar or vector types');
        }
        names.add(field?.name);
      }
    }
    if (!/^[A-Za-z_]\w*$/.test(config.elementType) || storageValueLayout(config.elementType)) {
      errors.push('Struct type must be a shader identifier');
    }
  }
  return errors;
}

function validateInitialData(config: StorageBufferConfig): string[] {
  const errors: string[] = [];
  if (config.initialData !== undefined && (typeof config.initialData !== 'string'
    || config.initialData.length > 4 * Math.ceil(262144 / 3)
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(config.initialData))) {
    errors.push('Initial data must be base64 binary data up to 256 KiB');
  }
  const layout = errors.length ? null : configuredStorageLayout(config);
  if (layout && config.initialData && config.initialData.length * 3 / 4 - (config.initialData.endsWith('==') ? 2 : config.initialData.endsWith('=') ? 1 : 0) > layout.stride * config.count) {
    errors.push('Initial data exceeds the buffer size');
  }
  return errors;
}

/** Shared validation for UI mutations and runtime graph construction. */
export function validateStorageOptions(config: StorageBufferConfig): string[] {
  if (!config || typeof config !== 'object') {
    return ['Storage configuration must be an object'];
  }
  const errors = [...validateFields(config), ...validateInitialData(config)];
  for (const key of ['clearEachFrame', 'resetOnRestart'] as const) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      errors.push(`${key} must be a boolean`);
    }
  }
  return errors;
}
