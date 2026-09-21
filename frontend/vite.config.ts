import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端开发服务器：把 /api 与 /assets 反向代理到后端（默认 http://localhost:3000）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3000',
      '/assets': 'http://localhost:3000',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
