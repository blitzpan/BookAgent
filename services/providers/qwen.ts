// 向后兼容：qwen 即阿里云百炼平台（通义千问 + 通义万相）的文本/视觉/图像后端。
// 实际实现见 ./bailian.ts；此处仅重新导出，避免历史引用（如 index.ts 的 qwen 别名）断裂。
export { createBailianBackend as createQwenBackend } from "./bailian";
