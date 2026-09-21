// Reader 后端 API 封装。字段以源码为准（见 docs/reader-dev-prompt.md §2）。
// 后端当前无法运行，支持 VITE_USE_MOCK 走本地示例数据联调。

import { mockStories, mockBook } from "../mock/fixtures";
import type { ReaderPage, ShelfBook } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

/** 相对资源路径 -> 完整 URL（image_path 形如 assets/1/1/101.png） */
export function assetUrl(rel?: string | null): string | null {
  if (!rel) return null;
  return `${API_BASE}/${rel.replace(/^\/+/, "")}`;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body?.error || `请求失败 ${res.status}`);
  }
  return (await res.json()) as T;
}

// ---- 后端真实响应结构（snake_case，以源码为准）----
export interface ApiStoryListItem {
  id: number;
  user_title: string | null;
  status: string;
  page_count: number;
  created_at: string | null;
}
interface ApiRun {
  id: number;
  story_id: number;
  scope: string;
  status: string;
  progress: string | null;
  [k: string]: unknown;
}
interface ApiRunDetail {
  run: ApiRun;
  characters: unknown[];
  pages: { page: { page_number: number; text_zh: string | null; text_en: string | null; [k: string]: unknown }; default_image: { image_path: string } | null; candidates: unknown[] }[];
  sequence_checks: unknown[];
}

/** 书架：仅取已发布（草稿不外泄） */
export async function getPublishedStories(): Promise<ShelfBook[]> {
  if (USE_MOCK) return mockStories();
  const data = await fetchJson<{ stories: ApiStoryListItem[] }>(
    "/api/stories?status=审批通过的作品"
  );
  return data.stories.map((s) => ({
    id: s.id,
    userTitle: s.user_title,
    status: s.status,
    pageCount: s.page_count,
    createdAt: s.created_at,
    coverUrl: null,
  }));
}

/**
 * 阅读器：合并某书的文本与默认图。
 * 流程：story 详情（文本） -> runs（取最新完成 run） -> run 详情（默认图）。
 */
export async function getBook(storyId: number): Promise<ReaderPage[]> {
  if (USE_MOCK) return mockBook(storyId);

  const detail = await fetchJson<{ story: unknown; pages: { page_number: number; text_zh: string | null; text_en: string | null }[] }>(
    `/api/stories/${storyId}`
  );
  const runs = await fetchJson<{ runs: ApiRun[] }>(`/api/stories/${storyId}/runs`);
  const run = runs.runs.find(
    (r) => r.status === "completed" || r.status === "partial_failed"
  );

  const textByPage = new Map<number, { text_zh: string | null; text_en: string | null }>();
  for (const p of detail.pages) textByPage.set(p.page_number, p);

  const imageByPage = new Map<number, string | null>();
  if (run) {
    const rd = await fetchJson<ApiRunDetail>(`/api/runs/${run.id}`);
    for (const pd of rd.pages) {
      if (pd.default_image) imageByPage.set(pd.page.page_number, pd.default_image.image_path);
    }
  }

  const nums = Array.from(textByPage.keys()).sort((a, b) => a - b);
  return nums.map((n) => {
    const t = textByPage.get(n)!;
    return {
      pageNumber: n,
      textZh: t.text_zh ?? null,
      textEn: t.text_en ?? null,
      imageUrl: assetUrl(imageByPage.get(n)),
    };
  });
}
