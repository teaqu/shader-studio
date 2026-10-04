import { defineProject } from 'vitest/config';

// Pure extension units run in Node; VS Code API integration remains in the
// existing extension-host suite. This project supplies Istanbul counters too.
export default defineProject({
  test: {
    name: 'extension-units',
    environment: 'node',
    include: ['src/test/unit/**/*.test.{ts,mts}'],
  },
});
