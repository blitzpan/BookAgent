// 与后端 src/types.ts 对齐的前端类型（只保留 UI 用得到的字段）。

/** 生图配置（与后端 constants/generationConfig.ts 对齐）。 */
export interface GenerationConfig {
  frame_threshold: number;
  max_frame_retry: number;
  sequence_threshold: number;
  max_sequence_retry: number;
  initial_retry_budget: number;
  aspect_ratio: string;
  image_size: string;
}

export interface StorySummary {
  id: number;
  user_title: string | null;
  status: string;
  page_count: number;
  created_at: string | null;
}

export interface Story {
  id: number;
  user_title: string | null;
  ai_title_zh: string | null;
  ai_title_en: string | null;
  original_text: string;
  refined_text: string | null;
  style: string | null;
  target_page_count: number | null;
  status: string;
  safety_result: string | null;
  rewrite_result: string | null;
  inspiration_image_path: string | null;
  generation_config: GenerationConfig | null;
  current_run_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

/** 一次异步执行（整书生图 / 单页补画）。 */
export interface GenerationTask {
  id: number;
  story_id: number;
  run_id: number | null;
  page_id: number | null;
  kind: 'full' | 'single_page';
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: string | null;
  last_error: string | null;
  created_at: string | null;
  finished_at: string | null;
}

export interface Page {
  id: number;
  story_id: number;
  page_number: number;
  text_zh: string | null;
  text_en: string | null;
  image_prompt: string | null;
  lock_text: string | null;
}

/** 一次整书生成 = 一个版本。进度/错误属于任务，不在这里。 */
export interface GenerationRun {
  id: number;
  story_id: number;
  status: string;
  frame_threshold: number | null;
  max_frame_retry: number | null;
  sequence_threshold: number | null;
  max_sequence_retry: number | null;
  initial_retry_budget: number | null;
  text_provider: string | null;
  image_provider: string | null;
  vision_provider: string | null;
  aspect_ratio: string | null;
  image_size: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
}

export interface PageImage {
  id: number;
  is_default: number;
  kind: string | null;
  combined_score: number | null;
  identity_score: number | null;
  frame_score: number | null;
  image_path: string | null;
  attempt_index: number | null;
  created_at: string | null;
}

export interface Character {
  id: number;
  char_key: string | null;
  name: string | null;
  visual_description: string | null;
  sheet_image_path: string | null;
}

export interface PageDetail {
  page: Page;
  default_image: PageImage | null;
  candidates: PageImage[];
}

export interface SequenceCheck {
  id: number;
  story_id: number;
  generation_run_id: number;
  is_consistent: number | null;
  score: number | null;
  issues: string | null;
  problem_pages: string | null;
}

export interface RunDetail {
  run: GenerationRun;
  characters: Character[];
  pages: PageDetail[];
  sequence_checks: SequenceCheck[];
}

/** 生图时的可选一次性覆盖（一般不传，用故事配置）。 */
export type GenerateConfig = Partial<GenerationConfig>;
