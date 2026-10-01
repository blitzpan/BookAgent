// Reader 端数据类型，字段对齐 backend 真实响应（见 docs/reader-dev-prompt.md §2）。
// 注意：后端返回 snake_case（DB 原行），这里在 api/client.ts 中已映射为 camelCase。

export type LangMode = "zh" | "en" | "both";
export type ReadMode = "single" | "spread";

export interface Hotspot {
  x: number; // 中心点 归一化 0~1（尺寸不入库，由 label 渲染自动推导）
  y: number;
  type: string; // 兼容旧字段（= kind）
  kind: "audio" | "text" | "link";
  segment_seq: number | null;
  payload: string | null;
  label?: string | null;
}

/** 单页分段（双语、按场景区分角色/音色） */
export interface ReaderSegment {
  seq: number;
  role: "narration" | "dialogue" | "background" | "sfx";
  speaker: string | null;
  speakerEn: string | null;
  textZh: string;
  textEn: string;
  /** 各语言音频 URL（已拼 API_BASE）；无则 undefined */
  audioUrls: { zh?: string; en?: string };
}

/** 单页阅读数据 */
export interface ReaderPage {
  pageNumber: number;
  textZh: string | null; // 来自 page.text_zh（MVP 多为 null）
  textEn: string | null; // 来自 page.text_en
  imageUrl: string | null; // 来自 default_image.image_path 拼 API_BASE；无图则 null
  audioUrl?: string; // 预留：每页音频（后端未来入库）
  hotspots?: Hotspot[]; // 预留：热区（后端未来入库）
  segments?: ReaderSegment[]; // 分段配音（按 seq 排列；无则按整页文本）
}

/** 书架卡片 */
export interface ShelfBook {
  id: number;
  userTitle: string | null;
  status: string;
  pageCount: number;
  createdAt: string | null;
  coverUrl: string | null; // 当前后端列表不带图，恒为 null（标题卡占位）
}
