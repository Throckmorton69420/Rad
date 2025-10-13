import path from 'path';
import { defineConfig } from 'vite';

const __dirname = new URL('.', import.meta.url).pathname;

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  // The 'define' block has been removed. Vite automatically handles environment
  // variables prefixed with VITE_ in client-side code, making this block
  // unnecessary and potentially problematic.
});