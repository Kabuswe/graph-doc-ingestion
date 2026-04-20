import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 180000, // Xenova model download on first run
    hookTimeout: 30000,
    reporters: ['verbose'],
    pool: 'forks',       // isolate heavy transformer model loading
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
