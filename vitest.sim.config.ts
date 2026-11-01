import { defineConfig } from 'vitest/config';

// The speedrun: ten simulated people, 98 days each (tests/sim). Slow; not part of `npm test`.
export default defineConfig({
  define: { __BUILD_TIME__: '"sim"', __APP_VERSION__: '"sim"' },
  test: { include: ['tests/sim/**/*.sim.ts'], environment: 'node', testTimeout: 600_000, fileParallelism: false },
});
