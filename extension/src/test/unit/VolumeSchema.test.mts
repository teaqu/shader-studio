import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv = require('ajv');

const schema = JSON.parse(readFileSync(new URL('../../../schemas/shader-config.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);
const config = (input: unknown) => ({ version: '1.0', passes: { Image: { inputs: { density: input } } } });

describe('persisted volume input schema', () => {
  it.each([undefined, 'linear', 'nearest'])('accepts KTX2 volume paths with filter %s and all wrap modes', filter => {
    for (const wrap of [undefined, 'repeat', 'clamp']) {
      expect(validate(config({ type: 'volume', path: './cloud.ktx2', filter, wrap })), JSON.stringify(validate.errors)).toBe(true);
    }
  });
  it.each([
    { type: 'volume' }, { type: 'volume', path: '' }, { type: 'volume', path: 4 },
    { type: 'volume', path: 'a.ktx2', filter: 'mipmap' },
    { type: 'volume', path: 'a.ktx2', wrap: 'mirror' },
    { type: 'volume', path: 'a.ktx2', resolved_path: 'https://assets/a.ktx2' },
    { type: 'volume', path: 'a.ktx2', vflip: true },
  ])('rejects invalid or transient volume fields %j', input => {
    expect(validate(config(input))).toBe(false);
  });
});
