import path from 'path';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      // FIX: Use path.resolve with relative paths, which defaults to the current working directory, avoiding process.cwd() type issues.
      '@': path.resolve('./'),
      'components': path.resolve('components'),
      'hooks': path.resolve('hooks'),
      'services': path.resolve('services'),
      'utils': path.resolve('utils'),
    },
  },
});
