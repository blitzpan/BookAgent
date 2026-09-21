// 与数据库表对应的实体类型（运行时从 better-sqlite3 读出的是普通对象，这里仅做形状约束）。

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
  safety_result: string | null; // JSON
  rewrite_result: string | null; // JSON
  inspiration_image_path: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface Character {
  id: number;
  story_id: number;
  generation_run_id: number;
  char_key: string | null;
  name: string | null;
  visual_description: string | null;
  sheet_image_path: string | null;
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

export type RunScope = "full" | "single_page";
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial_failed"
  | "failed"
  | "interrupted";

export interface GenerationRun {
  id: number;
  story_id: number;
  scope: RunScope;
  target_page_id: number | null;
  status: RunStatus;
  progress: string | null; // JSON {total,done,failed}
  last_error: string | null;
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

export type ImageKind = "initial" | "retry" | "manual_new" | "redraw";

export interface PageImage {
  id: number;
  page_id: number;
  story_id: number;
  generation_run_id: number;
  is_default: number; // 0/1
  kind: ImageKind | null;
  prompt_used: string | null;
  reference_sheet_ids: string | null; // JSON
  image_path: string | null;
  identity_score: number | null;
  identity_issues: string | null;
  frame_score: number | null;
  frame_issues: string | null;
  combined_score: number | null;
  safety_passed: number | null;
  reference_image_id: number | null;
  attempt_index: number | null;
  created_at: string | null;
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

// 单页（与前端 types.ts 的 StoryPage 对齐；imageUrl 在后端为可选，仅编排期内存使用）
export interface StoryPage {
  pageNumber: number;
  text: string;
  imagePrompt: string;
  imageUrl?: string;
}

// 新建故事请求
export interface CreateStoryInput {
  original_text: string;
  style?: string;
  target_page_count?: number;
  user_title?: string;
  inspiration_image_path?: string;
}

// 生图配置（POST /generate 请求体，落 snapshot 进 generation_runs）
export interface GenerateConfig {
  frame_threshold?: number;
  max_frame_retry?: number;
  sequence_threshold?: number;
  max_sequence_retry?: number;
  initial_retry_budget?: number;
  text_provider?: string;
  image_provider?: string;
  vision_provider?: string;
  aspect_ratio?: string;
  image_size?: string;
}
