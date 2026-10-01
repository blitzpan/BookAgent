import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端开发服务器：把 /api 与 /assets 反向代理到后端（默认 http://localhost:3000）。
// 端口固定 5174：5173 留给 reader（阅读端），两者可同时启动。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
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
  // 一键预览阅读端：注入 READER_BASE（阅读端 dev=5173，生产用环境变量覆盖）
  define: {
    'import.meta.env.VITE_READER_BASE': JSON.stringify(
      process.env.READER_BASE || 'http://localhost:5173'
    ),
  },
});
