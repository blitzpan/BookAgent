import type {
  StorySummary,
  Story,
  Page,
  GenerationRun,
  RunDetail,
  GenerateConfig,
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
  listStories: () => request<{ stories: StorySummary[] }>('GET', '/api/stories'),
  createStory: (input: {
    original_text: string;
    style?: string;
    target_page_count?: number;
    user_title?: string;
    inspiration_image?: string;
  }) => request<{ id: number }>('POST', '/api/stories', input),
  getStory: (id: number) =>
    request<{ story: Story; pages: Page[] }>('GET', `/api/stories/${id}`),
  rewriteStory: (id: number) =>
    request<{
      storyId: number;
      mode: string;
      feedback: string;
      pageCount: number;
      safetyNote: string | null;
    }>('POST', `/api/stories/${id}/rewrite`),
  generate: (id: number, cfg: GenerateConfig) =>
    request<{ runId: number }>('POST', `/api/stories/${id}/generate`, cfg),
  listRuns: (id: number) =>
    request<{ runs: GenerationRun[] }>('GET', `/api/stories/${id}/runs`),
  getRun: (runId: number) => request<RunDetail>('GET', `/api/runs/${runId}`),
  addPageImage: (pageId: number, body: { kind?: string }) =>
    request<{ runId: number }>('POST', `/api/pages/${pageId}/images`, body),
  setDefaultImage: (imageId: number) =>
    request<{ ok: true }>('PATCH', `/api/page-images/${imageId}`),
  publish: (id: number) =>
    request<{ ok: true; status: string }>('POST', `/api/stories/${id}/publish`),
  deleteStory: (id: number) =>
    request<{ ok: true }>('DELETE', `/api/stories/${id}`),
};
