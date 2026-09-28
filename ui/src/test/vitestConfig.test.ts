// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';

describe('UI Vitest worker budget', () => {
  it('uses four isolated forks without the removed Vitest 3 pool options', () => {
    const test = config.test as {
      maxWorkers?: number;
      fileParallelism?: boolean;
      pool?: string;
      poolOptions?: unknown;
    };

    expect(test.pool).toBe('forks');
    expect(test.maxWorkers).toBe(4);
    expect(test.fileParallelism).toBeUndefined();
    expect(test.poolOptions).toBeUndefined();
  });
});
