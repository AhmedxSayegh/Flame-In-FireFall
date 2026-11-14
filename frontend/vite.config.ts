import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Frontend ↔ backend link:
//  - npm run build → writes dist/, which backend/app.py serves at http://127.0.0.1:5000
//  - npm run dev   → http://localhost:5173, and every /api request is forwarded to the backend on port 5000
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:5000' },
    fs: { allow: ['..'] }, // lets the dev server read ../shared/schemas
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
