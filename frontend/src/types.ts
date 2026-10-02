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
  updated_at: string | null;
  // 当前生效版本第 1 页默认图地址（已拼 /assets/ 前缀）；无图时为 null。
  cover_url: string | null;
  // 是否生过图（current_run_id 非空）
  currentRunId: number | null;
  // 热区层快照：是否曾配置过热区（不区分次数，至少一次）
  hasHotspots: number | null;
  // 配音派生：isGenerating → 配音中；hasAudioDone → 已有一组 completed；audioSetCount → 配音方案总数
  isGenerating: number;
  hasAudioDone: number;
  audioSetCount: number;
  selectedAudioSetId: number | null;
}

export interface StoryListFilter {
  title?: string;
  status?: string;
  generated?: "all" | "done" | "none" | "partial";
  audio?: "all" | "done" | "none" | "generating" | "interrupted";
  hotspots?: "all" | "done" | "none";
}

export type AudioSetStatus = 'pending' | 'generating' | 'completed' | 'interrupted' | 'failed';
export type Lang = 'zh' | 'en';

export interface AudioSetConfig {
  /** 按 role（narration/dialogue/...）指定音色。 */
  voices?: Partial<Record<string, Partial<Record<Lang, string>>>>;
  /** 按角色名指定音色（优先级高于 voices）。 */
  voicesBySpeaker?: Record<string, Partial<Record<Lang, string>>>;
  langs?: Lang[];
}

// ===================== 音色 / 角色选角 =====================
export type VoiceCategory = 'mandarin' | 'dialect' | 'english';

/** 一条可用音色（来自「设置 → 更新音色」经 AI 筛选后的池，或内置默认池）。 */
export interface VoiceOption {
  id: string;
  label: string;
  gender: 'male' | 'female';
  child?: boolean;
  tags: string[];
  locale?: string;
  category?: VoiceCategory;
}

/** narration=旁白音色，fallback=其余角色兜底音色，character=具体角色专属音色。 */
export type CastSlot = 'narration' | 'fallback' | 'character';

export interface SpeakerVoice {
  slot: CastSlot;
  speaker: string;
  speakerEn: string | null;
  voiceZh: string | null;
  voiceEn: string | null;
  altVoices: string[];
  lineCount: number;
  source: string; // 'ai' | 'manual' | 'fallback'
  reason: string | null;
}

export interface VoicePoolStats {
  total: number;
  mandarin: number;
  dialect: number;
  english: number;
  updatedAt: string | null;
  source: 'ai' | 'builtin';
}

export interface AudioSet {
  id: number;
  name: string;
  status: AudioSetStatus;
  is_selected: number;
  config_json: string | null;
  created_at: string | null;
  // 进度：预期音频数 / 已生成数（来自 page_audio）
  total: number;
  done: number;
}

/** /api/stories/:id 详情的配音相关兜底字段。 */
export interface StoryAudioState {
  audioSets: AudioSet[];
  selectedAudioSetId: number | null;
  /** 发布前资产完整性快照（缺什么列什么）。 */
  readiness: PublishReadiness;
}

/** 发布前资产完整性：images/texts 为硬门禁（非空即拒绝发布），audio/hotspots 为软提示。 */
export interface PublishReadiness {
  pages: number;
  images: number[]; // 缺默认图的页码
  texts: number[]; // 缺中英文本的页码
  audio: boolean; // true = 缺配音
  hotspots: number[]; // 无热区的页码
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
  selected_audio_set_id: number | null;
  has_audio: number | null; // 层快照：是否曾生成配音（不区分次数，至少一次）
  has_hotspots: number | null; // 层快照：是否曾配置热区
  cover_url: string | null;
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
  kind: 'full' | 'single_page' | 'tts';
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

// ===================== 图片热区 =====================
export type HotspotKind = 'audio' | 'text' | 'link';
export type HotspotSource = 'ai' | 'manual';

/** 热区（snake_case，对齐后端 page_hotspots 行）。只存中心点 (x,y) 归一化 0~1；尺寸由 label 渲染推导。 */
export interface Hotspot {
  id: number;
  story_id: number;
  page_number: number;
  segment_seq: number | null;
  x: number;
  y: number;
  shape: string;
  kind: HotspotKind;
  label: string | null;
  payload: string | null;
  source: HotspotSource;
  confidence: number | null;
}

/** 新建/更新热区的请求体。 */
export interface HotspotInput {
  segment_seq?: number | null;
  x: number;
  y: number;
  shape?: 'rect' | 'circle';
  kind?: HotspotKind;
  label?: string | null;
  payload?: string | null;
}
