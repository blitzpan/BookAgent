import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // 国内模型（如 Seedream / 百炼）直接浏览器调用会被 CORS 拦截，这里用 dev 代理转发。
        // 前端以相对路径 /xxx-api 调用，由本代理转发到对应厂商域名，绕开浏览器 CORS。
        proxy: {
          // 阿里云百炼（通义千问 + 通义万相）：前缀 /bailian-api 被 rewrite 去掉，
          // 因此可同时服务文本/视觉的 /compatible-mode/v1/chat/completions
          // 与图像的 /api/v1/services/aigc/multimodal-generation/generation。
          // 阿里云百炼：前缀 /bailian-api 被 rewrite 去掉，
          // 因此可同时服务文本/视觉的 /compatible-mode/v1/chat/completions
          // 与图像的 /api/v1/services/aigc/multimodal-generation/generation。
          // 代理目标默认公共 dashscope；私有业务空间用 BAILIAN_PROXY_TARGET 指定。
          '/bailian-api': {
            target: env.BAILIAN_PROXY_TARGET || 'https://dashscope.aliyuncs.com',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/bailian-api/, ''),
          },
          // 火山方舟（文本 + 视觉 + 图像，统一单一域名）
          '/ark-api': {
            target: 'https://ark.cn-beijing.volcesengine.com',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/ark-api/, ''),
          },
          '/seedream-api': {
            target: 'https://ark.cn-beijing.volcesengine.com',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/seedream-api/, '/api/v3/images/generations'),
          },
        },
      },
      plugins: [react()],
      define: {
        // 原有 Gemini 变量
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_TEXT_MODEL': JSON.stringify(env.GEMINI_TEXT_MODEL),
        'process.env.GEMINI_VISION_MODEL': JSON.stringify(env.GEMINI_VISION_MODEL),
        'process.env.GEMINI_IMAGE_MODEL': JSON.stringify(env.GEMINI_IMAGE_MODEL),
        // 多模型：角色 -> provider 选择
        'process.env.TEXT_PROVIDER': JSON.stringify(env.TEXT_PROVIDER),
        'process.env.IMAGE_PROVIDER': JSON.stringify(env.IMAGE_PROVIDER),
        'process.env.VISION_PROVIDER': JSON.stringify(env.VISION_PROVIDER),
        // 阿里云百炼（文本 + 视觉 + 图像，DashScope 网关；与 QWEN_* 共用 Key/网关）
        'process.env.BAILIAN_API_KEY': JSON.stringify(env.BAILIAN_API_KEY),
        'process.env.BAILIAN_BASE_URL': JSON.stringify(env.BAILIAN_BASE_URL),
        'process.env.BAILIAN_TEXT_MODEL_NAME': JSON.stringify(env.BAILIAN_TEXT_MODEL_NAME),
        'process.env.BAILIAN_VISION_MODEL_NAME': JSON.stringify(env.BAILIAN_VISION_MODEL_NAME),
        'process.env.BAILIAN_IMAGE_MODEL_NAME': JSON.stringify(env.BAILIAN_IMAGE_MODEL_NAME),
        // 国内模型：Qwen（文本 + 视觉，DashScope）— 作为百炼的回退 Key/网关
        'process.env.QWEN_API_KEY': JSON.stringify(env.QWEN_API_KEY),
        'process.env.QWEN_BASE_URL': JSON.stringify(env.QWEN_BASE_URL),
        'process.env.QWEN_TEXT_MODEL_NAME': JSON.stringify(env.QWEN_TEXT_MODEL_NAME),
        'process.env.QWEN_VISION_MODEL_NAME': JSON.stringify(env.QWEN_VISION_MODEL_NAME),
        // 国内模型：火山方舟（文本 + 视觉 + 图像，单一 ARK_API_KEY）
        'process.env.ARK_API_KEY': JSON.stringify(env.ARK_API_KEY),
        'process.env.ARK_BASE_URL': JSON.stringify(env.ARK_BASE_URL),
        'process.env.ARK_TEXT_MODEL_NAME': JSON.stringify(env.ARK_TEXT_MODEL_NAME),
        'process.env.ARK_VISION_MODEL_NAME': JSON.stringify(env.ARK_VISION_MODEL_NAME),
        'process.env.ARK_IMAGE_MODEL_NAME': JSON.stringify(env.ARK_IMAGE_MODEL_NAME),
        // 国内模型：Seedream（图像，火山方舟）
        'process.env.SEEDREAM_API_KEY': JSON.stringify(env.SEEDREAM_API_KEY),
        'process.env.SEEDREAM_BASE_URL': JSON.stringify(env.SEEDREAM_BASE_URL),
        'process.env.SEEDREAM_MODEL_NAME': JSON.stringify(env.SEEDREAM_MODEL_NAME),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
