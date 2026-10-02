import type {
  StorySummary,
  StoryListFilter,
  Story,
  StoryAudioState,
  Page,
  GenerationRun,
  GenerationTask,
  GenerationConfig,
  RunDetail,
  GenerateConfig,
  AudioSet,
  Lang,
  Hotspot,
  HotspotInput,
} from '../types';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// 后端 /assets/* 以 ASSETS_DIR(= DATA_DIR/assets) 为根；而 image_path 存的是相对 DATA_DIR 的
// "assets/..." 形式。因此去掉开头的 "assets/" 再拼 /assets/ 前缀，避免 assets/assets 双重前缀导致 404。
export function assetUrl(rel?: string | null): string | null {
  if (!rel) return null;
  const stripped = rel.replace(/^assets[/\\]/, '');
  return `/assets/${stripped}`;
}

export const api = {
  listStories: (filter?: StoryListFilter) => {
    const qs = new URLSearchParams();
    if (filter?.title) qs.set('title', filter.title);
    if (filter?.status) qs.set('status', filter.status);
    if (filter?.generated && filter.generated !== 'all') qs.set('generated', filter.generated);
    if (filter?.audio && filter.audio !== 'all') qs.set('audio', filter.audio);
    if (filter?.hotspots && filter.hotspots !== 'all') qs.set('hotspots', filter.hotspots);
    const q = qs.toString();
    return request<{ stories: StorySummary[] }>('GET', `/api/stories${q ? `?${q}` : ''}`);
  },
  createStory: (input: {
    original_text: string;
    style?: string;
    target_page_count?: number;
    user_title?: string;
    inspiration_image?: string;
  }) => request<{ id: number }>('POST', '/api/stories', input),
  // ===== 草稿旁路：主题生成 / 多轮优化（不落库，纯文本生成）=====
  generateStory: (input: { theme: string }) =>
    request<{ story: string }>('POST', '/api/story-draft/generate', input),
  optimizeStory: (input: {
    story: string;
    feedback: string;
    applied_feedback?: string[];
  }) => request<{ story: string }>('POST', '/api/story-draft/optimize', input),
  getStory: (id: number) =>
    request<
      { story: Story; pages: Page[]; segment_count: number } & StoryAudioState
    >('GET', `/api/stories/${id}`),
  updateStory: (
    id: number,
    body: {
      user_title?: string | null;
      style?: string | null;
      target_page_count?: number | null;
      inspiration_image?: string;
      generation_config?: Partial<GenerationConfig>;
    }
  ) => request<{ story: Story }>('PATCH', `/api/stories/${id}`, body),
  rewriteStory: (id: number) =>
    request<{
      storyId: number;
      mode: string;
      feedback: string;
      pageCount: number;
      safetyNote: string | null;
      hotspotsRemoved: number;
    }>('POST', `/api/stories/${id}/rewrite`),
  generate: (id: number, cfg?: GenerateConfig) =>
    request<{ taskId: number; runId: number }>(
      'POST',
      `/api/stories/${id}/generate`,
      cfg ?? {}
    ),
  listRuns: (id: number) =>
    request<{ runs: GenerationRun[] }>('GET', `/api/stories/${id}/runs`),
  getRun: (runId: number) => request<RunDetail>('GET', `/api/runs/${runId}`),
  getTask: (taskId: number) =>
    request<{ task: GenerationTask }>('GET', `/api/tasks/${taskId}`),
  cancelTask: (taskId: number) =>
    request<{ ok: boolean }>('POST', `/api/tasks/${taskId}/cancel`),
  listActiveTasks: (storyId: number) =>
    request<{
      tasks: Array<{
        id: number;
        kind: string;
        status: string;
        pageId: number | null;
        progress: { total: number; done: number; failed: number };
      }>;
    }>('GET', `/api/stories/${storyId}/tasks/active`),
  addPageImage: (pageId: number, body: { kind?: string; image?: string }) =>
    request<{ taskId?: number; imageId?: number }>(
      'POST',
      `/api/pages/${pageId}/images`,
      body
    ),
  setDefaultImage: (imageId: number) =>
    request<{ ok: true }>('PATCH', `/api/page-images/${imageId}`),
  publish: (id: number, force = false) =>
    request<{ ok: true; status: string; missing?: unknown }>(
      'POST',
      `/api/stories/${id}/publish${force ? '?force=1' : ''}`
    ),
  deleteStory: (id: number) =>
    request<{ ok: true }>('DELETE', `/api/stories/${id}`),
  // ===== 配音（TTS）：独立接口，与生图完全解耦 =====
  generateTts: (
    storyId: number,
    opts?: { name?: string; langs?: Lang[]; regenerate?: boolean; forceNew?: boolean }
  ) =>
    request<{ taskId: number; audioSetId: number }>(
      'POST',
      `/api/stories/${storyId}/tts`,
      opts ?? {}
    ),
  listAudioSets: (storyId: number) =>
    request<{ audioSets: AudioSet[] }>('GET', `/api/stories/${storyId}/audio-sets`),
  selectAudioSet: (setId: number) =>
    request<{ ok: true }>('POST', `/api/audio-sets/${setId}/select`),
  resumeAudioSet: (setId: number) =>
    request<{ taskId: number; audioSetId: number }>(
      'POST',
      `/api/audio-sets/${setId}/resume`
    ),
  deleteAudioSet: (setId: number) =>
    request<{ ok: true }>('DELETE', `/api/audio-sets/${setId}`),
  getBookAudio: (storyId: number, setId?: number) =>
    request<{
      audioSetId: number | null;
      pages: Array<{
        pageNumber: number;
        segments: Array<{
          seq: number;
          role: string;
          speaker: string | null;
          textZh: string;
          textEn: string;
          audioUrls: { zh?: string; en?: string };
        }>;
      }>;
    }>('GET', `/api/stories/${storyId}/book-audio${setId ? `?setId=${setId}` : ''}`),
  // ===== 图片热区 =====
  listHotspots: (storyId: number) =>
    request<{ hotspots: Hotspot[] }>('GET', `/api/stories/${storyId}/hotspots`),
  listPageHotspots: (storyId: number, pageNumber: number) =>
    request<{ hotspots: Hotspot[] }>(
      'GET',
      `/api/stories/${storyId}/pages/${pageNumber}/hotspots`
    ),
  createHotspot: (storyId: number, pageNumber: number, input: HotspotInput) =>
    request<Hotspot>('POST', `/api/stories/${storyId}/pages/${pageNumber}/hotspots`, input),
  updateHotspot: (id: number, patch: Partial<HotspotInput>) =>
    request<Hotspot>('PATCH', `/api/hotspots/${id}`, patch),
  deleteHotspot: (id: number) =>
    request<{ ok: true }>('DELETE', `/api/hotspots/${id}`),
  autoGenerateHotspots: (storyId: number, regenerate?: boolean) =>
    request<{ taskId: number }>(
      'POST',
      `/api/stories/${storyId}/hotspots/auto-generate`,
      regenerate === undefined ? {} : { regenerate }
    ),
  resumeHotspots: (storyId: number) =>
    request<{ taskId: number }>('POST', `/api/stories/${storyId}/hotspots/resume`),
  getHotspotTask: (storyId: number) =>
    request<{ task: GenerationTask | null }>(
      'GET',
      `/api/stories/${storyId}/hotspots/task`
    ),
  savePageHotspots: (
    storyId: number,
    pageNumber: number,
    payload: {
      create?: HotspotInput[];
      update?: Array<{ id: number } & Partial<HotspotInput>>;
      delete?: number[];
    }
  ) =>
    request<{ created: number; updated: number; deleted: number }>(
      'POST',
      `/api/stories/${storyId}/pages/${pageNumber}/hotspots/batch`,
      payload
    ),
  getHotspotEditorData: (storyId: number) =>
    request<{
      pages: Array<{
        pageNumber: number;
        imagePath: string | null;
        segments: Array<{
          seq: number;
          textZh: string;
          textEn: string;
          audioUrls: { zh?: string; en?: string };
        }>;
      }>;
    }>('GET', `/api/stories/${storyId}/hotspot-editor`),
};
