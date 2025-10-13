import path from 'path';
import { defineConfig, loadEnv } from 'vite';
// FIX: Import 'process' to provide correct types for process.cwd() and avoid type errors.
import process from 'process';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    resolve: {
      alias: {
        // FIX: __dirname is not available in this module context. Using process.cwd() is a reliable way to get the project root.
        '@': path.resolve(process.cwd(), './'),
        'components': path.resolve(process.cwd(), './components'),
        'hooks': path.resolve(process.cwd(), './hooks'),
        'services': path.resolve(process.cwd(), './services'),
        'utils': path.resolve(process.cwd(), './utils'),
      },
    },
    define: {
      'process.env': {
        'VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
        'VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY)
      }
    }
  }
});
