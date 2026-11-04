import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  optimizeDeps: { exclude: ['manifold-3d'] },
  build: { target: 'es2022' },
});
