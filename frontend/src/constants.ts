import type { GenerationConfig } from './types';

// 与后端 constants/generationConfig.ts 对齐的兜底默认值：
// 正常情况后端总会下发 generation_config，这里只用于后端未返回时的占位。
export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  frame_threshold: 0.75,
  max_frame_retry: 3,
  sequence_threshold: 0.8,
  max_sequence_retry: 1,
  initial_retry_budget: 1,
  aspect_ratio: '4:3',
  image_size: '2K',
};
