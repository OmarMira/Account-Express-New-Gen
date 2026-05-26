import { defineConfig } from 'vitest/config';
import path from 'path';

// Override DATABASE_URL for tests to protect dev database from clearDatabase()
process.env.DATABASE_URL = 'file:./test.db';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    fileParallelism: false,
    maxWorkers: 1,
  },
});
