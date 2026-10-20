import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
const schema = JSON.parse(readFileSync(new URL('../../../schemas/shader-config.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);
const config = (initialDataFiles: unknown) => ({ version: '1.0', storage: { ram: { count: 32, elementType: 'uint', initialDataFiles } }, passes: { Image: {} } });
describe('storage initial data schema', () => {
  it('accepts zero, single and multiple file lists with optional offsets', () => {
    for (const files of [undefined, [], [{ path: 'a.bin' }], [{ path: '@/boot.bin', byteOffset: 0 }, { path: '/kernel.bin', byteOffset: 32 }]]) {
      expect(validate(config(files)), JSON.stringify(validate.errors)).toBe(true);
    }
  });
  it('rejects malformed paths, entries, offsets and host-only URLs', () => {
    for (const files of [null, {}, 'file.bin', [null], [[]], [{}], [{ path: '' }], [{ path: '  ' }], [{ path: 2 }], [{ path: 'a', byteOffset: -1 }], [{ path: 'a', byteOffset: 0.5 }], [{ path: 'a', byteOffset: '16' }], [{ path: 'a', byteOffset: 9007199254740992 }], [{ path: 'a', resolved_path: 'blob:abc' }]]) {
      expect(validate(config(files)), JSON.stringify(files)).toBe(false);
    }
  });
  it('accepts the storage layout and reset fields alongside files', () => {
    expect(validate({ version: '1.0', storage: { data: { count: 2, elementType: 'Data', fields: [{ name: 'value', type: 'float' }], initialDataFiles: [], clearEachFrame: false, resetOnRestart: true } }, passes: { Image: {} } })).toBe(true);
  });
});
