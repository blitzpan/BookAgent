// 与数据库表对应的实体类型（运行时从 better-sqlite3 读出的是普通对象，这里仅做形状约束）。

import type { GenerationConfig } from "./constants/generationConfig";

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
  generation_config: string | null; // JSON 生图参数
  current_run_id: number | null; // 当前生效版本
  selected_audio_set_id: number | null; // 当前选用配音方案
  cover_url: string | null; // 当前生效版本第 1 页默认图（接口层计算填充）
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

/** 页面内一段可朗读文本（旁白/对话/背景/音效）。 */
export type SegmentRole = "narration" | "dialogue" | "background" | "sfx";
export interface PageSegment {
  id: number;
  page_id: number;
  story_id: number;
  seq: number;
  role: SegmentRole;
  speaker: string | null;
  text_zh: string;
  text_en: string;
}

/** 配音方案（语音组）：一个故事可有多组，后台试听后选定一组作为正式版。 */
export interface AudioSet {
  id: number;
  story_id: number;
  name: string;
  status: "pending" | "generating" | "completed" | "interrupted" | "failed";
  config_json: string | null; // JSON: 各 role/lang 的 voice 配置
  is_selected: number; // 0/1
  created_at: string | null;
}

/** run 只描述「版本产出状态」；执行中的 queued/running 属于 task。 */
export type RunStatus = "running" | "completed" | "partial_failed" | "failed";

export type TaskKind = "full" | "single_page" | "tts" | "hotspot";
export type TaskStatus = "queued" | "running" | "completed" | "failed";

export interface GenerationRun {
  id: number;
  story_id: number;
  status: RunStatus;
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

export interface GenerationTask {
  id: number;
  story_id: number;
  run_id: number | null;
  page_id: number | null;
  kind: TaskKind;
  status: TaskStatus;
  progress: string | null; // JSON {total,done,failed}
  params_json: string | null;
  last_error: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export type ImageKind = "initial" | "retry" | "manual_new" | "redraw";

export interface PageImage {
  id: number;
  page_id: number;
  story_id: number;
  generation_run_id: number;
  task_id: number | null;
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

// 生图配置的一次性覆盖（POST /generate 请求体，可选；缺省读 stories.generation_config）。
// 模型不再由请求指定：provider 以 .env 为准，实际生效值落 generation_runs 留痕。
export type GenerateConfig = Partial<GenerationConfig>;
