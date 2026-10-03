// 图片热区服务：CRUD + AI 自动生成。
// - 热区按 (story_id, page_number) 归属，(x,y) 为中心点、归一化 0~1。
// - 不存尺寸：热区大小由 label 文案在渲染时自动推导（后端无字体渲染环境、无法测量文字，
//   任何入库的 w/h 都只能是估算垃圾值，故彻底移除该字段）。
// - AI 自动生成复用 providers 的 VISION 后端（与三个 Director 同范式），为每页各分段定位中心点。
// - 中心点落库前裁剪 [0,1]。

import path from "node:path";
import fs from "node:fs";
import { Type } from "@google/genai";
import type { GenerationTask } from "../types";
import { db, DATA_DIR, isCancelRequested, markTaskCancelled } from "../db/sqlite";
import { getPagesByStory, getStoryRaw } from "./storyService";
import { getBookAudio, getSelectedAudioSetId } from "./ttsService";
import {
  getTask,
  setTaskStatus,
  setTaskProgress,
  finishTask,
} from "./generationService";
import { getVisionBackend } from "../providers";
import { pathToInlineImagePart } from "../providers/util";
import { logger, timer } from "../logger";

const now = () => new Date().toISOString();

export type HotspotKind = "audio" | "text" | "link";
export type HotspotSource = "ai" | "manual";

/** 数据库行（snake_case，与前端/阅读端映射层对应）。 */
export interface HotspotRow {
  id: number;
  story_id: number;
  page_number: number;
  segment_seq: number | null;
  x: number;
  y: number;
  shape: string;
  kind: string;
  label: string | null;
  payload: string | null;
  source: string;
  confidence: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface HotspotInput {
  segment_seq?: number | null;
  x: number;
  y: number;
  shape?: "rect" | "circle";
  kind?: HotspotKind;
  label?: string | null;
  payload?: string | null;
}

const ALLOWED_KINDS: HotspotKind[] = ["audio", "text", "link"];

// 中心点裁剪到 [0,1]（尺寸由渲染推导，无需夹紧边距）。
function clampCenter(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

export function listByStory(storyId: number): HotspotRow[] {
  return db
    .prepare(
      `SELECT * FROM page_hotspots WHERE story_id = ? ORDER BY page_number ASC, id ASC`
    )
    .all(storyId) as HotspotRow[];
}

export function listByPage(storyId: number, pageNumber: number): HotspotRow[] {
  return db
    .prepare(
      `SELECT * FROM page_hotspots WHERE story_id = ? AND page_number = ? ORDER BY id ASC`
    )
    .all(storyId, pageNumber) as HotspotRow[];
}

export function createHotspot(
  storyId: number,
  pageNumber: number,
  input: HotspotInput
): HotspotRow {
  const x = clampCenter(input.x);
  const y = clampCenter(input.y);
  const kind = (ALLOWED_KINDS.includes(input.kind as HotspotKind)
    ? input.kind
    : "audio") as HotspotKind;
  const shape = input.shape === "circle" ? "circle" : "rect";
  const info = db
    .prepare(
      `INSERT INTO page_hotspots
        (story_id, page_number, segment_seq, x, y, shape, kind, label, payload, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`
    )
    .run(
      storyId,
      pageNumber,
      input.segment_seq ?? null,
      x,
      y,
      shape,
      kind,
      input.label ?? null,
      input.payload ?? null,
      now(),
      now()
    );
  // 层快照：任一热区存在即标记故事「已配置热区」（不区分次数，至少一次）。
  db.prepare(`UPDATE stories SET has_hotspots = 1, updated_at = ? WHERE id = ?`).run(
    now(),
    storyId
  );
  return db
    .prepare(`SELECT * FROM page_hotspots WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as HotspotRow;
}

/**
 * 单条更新。传 storyId 时校验归属（防止用别的故事的 id 改到别人的热区）；
 * 不传则行为同前，仅按 id 更新（内部批量路径已自行校验过 story_id）。
 */
export function updateHotspot(
  id: number,
  patch: Partial<HotspotInput>,
  storyId?: number
): HotspotRow | null {
  const existing = getHotspotRow(id, storyId);
  if (!existing) return null;

  const merged = {
    segment_seq:
      patch.segment_seq !== undefined ? patch.segment_seq : existing.segment_seq,
    x: patch.x !== undefined ? clampCenter(patch.x) : existing.x,
    y: patch.y !== undefined ? clampCenter(patch.y) : existing.y,
    shape:
      patch.shape === "circle" || patch.shape === "rect"
        ? patch.shape
        : (existing.shape as "rect" | "circle"),
    kind: patch.kind
      ? (ALLOWED_KINDS.includes(patch.kind) ? patch.kind : existing.kind)
      : (existing.kind as HotspotKind),
    label: patch.label !== undefined ? patch.label : existing.label,
    payload: patch.payload !== undefined ? patch.payload : existing.payload,
  };

  db.prepare(
    `UPDATE page_hotspots
     SET segment_seq=?, x=?, y=?, shape=?, kind=?, label=?, payload=?, updated_at=?
     WHERE id=?`
  ).run(
    merged.segment_seq ?? null,
    merged.x,
    merged.y,
    merged.shape,
    merged.kind,
    merged.label ?? null,
    merged.payload ?? null,
    now(),
    id
  );
  return db.prepare(`SELECT * FROM page_hotspots WHERE id = ?`).get(id) as HotspotRow;
}

/** 读取单条热区；传 storyId 时校验归属。 */
export function getHotspotRow(
  id: number,
  storyId?: number
): HotspotRow | undefined {
  return (
    storyId == null
      ? db.prepare(`SELECT * FROM page_hotspots WHERE id = ?`).get(id)
      : db
          .prepare(`SELECT * FROM page_hotspots WHERE id = ? AND story_id = ?`)
          .get(id, storyId)
  ) as HotspotRow | undefined;
}

/** 单条删除。传 storyId 时校验归属。 */
export function removeHotspot(id: number, storyId?: number): boolean {
  const info =
    storyId == null
      ? db.prepare(`DELETE FROM page_hotspots WHERE id = ?`).run(id)
      : db
          .prepare(`DELETE FROM page_hotspots WHERE id = ? AND story_id = ?`)
          .run(id, storyId);
  return info.changes > 0;
}

/** 热区必须落在真实存在的页上（且该页属于该故事）。 */
export function pageExists(storyId: number, pageNumber: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM pages WHERE story_id = ? AND page_number = ? LIMIT 1`
    )
    .get(storyId, pageNumber) as { ok: number } | undefined;
  return !!row;
}

export interface HotspotBatchChange {
  create?: HotspotInput[];
  update?: Array<{ id: number } & Partial<HotspotInput>>;
  delete?: number[];
}

/**
 * 单页批量保存：新增 / 修改 / 删除在一个事务里完成。
 * 前端只提交「变更项」，避免逐条请求（页数多时逐条保存会明显卡顿）。
 */
export function savePageHotspots(
  storyId: number,
  pageNumber: number,
  changes: HotspotBatchChange
): { created: number; updated: number; deleted: number } {
  if (!getStoryRaw(storyId)) throw new Error(`故事不存在: ${storyId}`);
  if (!pageExists(storyId, pageNumber)) throw new Error(`页码不存在: ${pageNumber}`);

  const result = db.transaction(() => {
    let created = 0;
    let updated = 0;
    let deleted = 0;

    for (const raw of changes.delete ?? []) {
      const id = Number(raw);
      if (!Number.isInteger(id)) continue;
      const info = db
        .prepare(
          `DELETE FROM page_hotspots WHERE id = ? AND story_id = ? AND page_number = ?`
        )
        .run(id, storyId, pageNumber);
      deleted += info.changes;
    }

    for (const u of changes.update ?? []) {
      const id = Number(u.id);
      if (!Number.isInteger(id)) continue;
      const { id: _drop, ...patch } = u;
      // 与 delete 分支一致：校验归属，避免用别的故事的 id 改到别人的热区
      if (updateHotspot(id, patch, storyId)) updated += 1;
    }

    for (const c of changes.create ?? []) {
      createHotspot(storyId, pageNumber, c);
      created += 1;
    }

    // 层快照：有新增则置 1；若本次删空了全部热区则归 0（createHotspot 已会置 1，这里仅处理删空情形）。
    if (created > 0) {
      db.prepare(`UPDATE stories SET has_hotspots = 1, updated_at = ? WHERE id = ?`).run(
        now(),
        storyId
      );
    } else if (deleted > 0) {
      const remain = (
        db.prepare(`SELECT COUNT(*) AS n FROM page_hotspots WHERE story_id = ?`).get(storyId) as {
          n: number;
        }
      ).n;
      if (remain === 0) {
        db.prepare(`UPDATE stories SET has_hotspots = 0, updated_at = ? WHERE id = ?`).run(
          now(),
          storyId
        );
      }
    }

    return { created, updated, deleted };
  });

  return result();
}

function getDefaultImagePath(pageId: number): string | null {
  const row = db
    .prepare(
      `SELECT image_path FROM page_images WHERE page_id = ? AND is_default = 1
       ORDER BY id DESC LIMIT 1`
    )
    .get(pageId) as { image_path: string } | undefined;
  return row?.image_path ?? null;
}

function getSegmentsForPage(pageId: number) {
  return db
    .prepare(
      `SELECT seq, text_zh, text_en, speaker, speaker_en FROM page_segments WHERE page_id = ? ORDER BY seq ASC`
    )
    .all(pageId) as Array<{ seq: number; text_zh: string; text_en: string; speaker: string | null; speaker_en: string | null }>;
}

export interface AutoHotspotOptions {
  /** true = 保留已有 AI 热区、只补缺失页（崩溃续跑 / 「继续生成」）；false = 先清 AI 热区再全量重生成 */
  resume?: boolean;
  taskId?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * AI 自动生成热区：遍历每页，用 VISION 后端为该页各分段定位中心点并落库（source='ai'）。
 * - 非续跑：先清旧 AI 热区；人工微调（source='manual'）始终保留。
 * - 续跑：已有 AI 热区的页直接跳过，避免重复消耗 VISION（崩溃重启后可继续）。
 * - 单页失败只累加 failed 并继续，不拖垮整本任务。
 */
export async function autoGenerateHotspots(
  storyId: number,
  opts: AutoHotspotOptions = {}
): Promise<{ placed: number; pages: number; skipped: number; failed: number }> {
  if (!getStoryRaw(storyId)) throw new Error(`故事不存在: ${storyId}`);

  const resume = opts.resume === true;
  if (!resume) {
    // 清掉旧 AI 热区，人工热区保留
    db.prepare(`DELETE FROM page_hotspots WHERE story_id = ? AND source = 'ai'`).run(
      storyId
    );
  }

  const pages = getPagesByStory(storyId);
  const t = timer();
  logger.info("hotspot", "start", {
    storyId,
    pages: pages.length,
    resume,
  });
  const hasAi = (pageNumber: number): boolean =>
    db
      .prepare(
        `SELECT 1 AS ok FROM page_hotspots
          WHERE story_id = ? AND page_number = ? AND source = 'ai' LIMIT 1`
      )
      .get(storyId, pageNumber) !== undefined;

  let placed = 0;
  let skipped = 0;
  let failed = 0;
  let done = 0;
  const tick = () => {
    done += 1;
    opts.onProgress?.(done, pages.length);
  };

  for (const page of pages) {
    // 取消检查（S16，页级）：被请求取消则停在当前页之前，已生成热区保留。
    if (opts.taskId != null && isCancelRequested(opts.taskId)) {
      markTaskCancelled(opts.taskId);
      break;
    }
    if (resume && hasAi(page.page_number)) {
      skipped += 1;
      tick();
      continue;
    }

    const imagePath = getDefaultImagePath(page.id);
    const segments = getSegmentsForPage(page.id);
    const absImage = imagePath ? path.join(DATA_DIR, imagePath) : null;
    if (!absImage || segments.length === 0 || !fs.existsSync(absImage)) {
      skipped += 1;
      tick();
      continue;
    }

    try {
      const boxes = await generateBoxesForPage(absImage, segments);
      if (!boxes.length) {
        skipped += 1;
      } else {
        db.transaction(() => {
          for (const b of boxes) {
            const seg = segments.find((s) => s.seq === b.segment_seq);
            const label = seg ? `${seg.text_zh}\n${seg.text_en}` : null;
            db.prepare(
              `INSERT INTO page_hotspots
                (story_id, page_number, segment_seq, x, y, shape, kind, label, payload, source, confidence, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'rect', 'audio', ?, NULL, 'ai', ?, ?, ?)`
            ).run(
              storyId,
              page.page_number,
              b.segment_seq,
              clampCenter(b.x),
              clampCenter(b.y),
              label,
              typeof b.confidence === "number" ? b.confidence : null,
              now(),
              now()
            );
          }
        })();
        placed += boxes.length;
      }
    } catch (err) {
      console.error(
        `AI 热区生成失败（故事 ${storyId} 第 ${page.page_number} 页）:`,
        err
      );
      failed += 1;
    }
    tick();
  }

  // 层快照：成功放置过热区即标记「已配置热区」。
  if (placed > 0) {
    db.prepare(`UPDATE stories SET has_hotspots = 1, updated_at = ? WHERE id = ?`).run(
      now(),
      storyId
    );
  }
  logger.info("hotspot", "summary", {
    storyId,
    placed,
    skipped,
    failed,
    pages: pages.length,
    duration_ms: t.elapsedMs(),
  });
  return { placed, pages: pages.length, skipped, failed };
}

/** AI 只负责给出「中心点」；尺寸由文案渲染推导，不落库。 */
interface VisionBox {
  segment_seq: number;
  x: number;
  y: number;
  confidence?: number;
}

// ===================== 编辑器数据（一次性拿全本每页图+分段+音频） =====================

export interface HotspotEditorSegment {
  seq: number;
  textZh: string;
  textEn: string;
  speaker?: string | null;
  speakerEn?: string | null;
  audioUrls: { zh?: string; en?: string };
}
export interface HotspotEditorPage {
  pageNumber: number;
  imagePath: string | null;
  segments: HotspotEditorSegment[];
}

/** 热区编辑器所需：每页默认图 + 该页分段（seq/中/英/音频 URL），一次返回。 */
export function getHotspotEditorData(
  storyId: number,
  audioSetId?: number | null
): { pages: HotspotEditorPage[] } {
  const resolvedAudioSet =
    audioSetId ?? getSelectedAudioSetId(storyId);
  const bookAudio = resolvedAudioSet
    ? getBookAudio(storyId, resolvedAudioSet)
    : null;

  const pages = getPagesByStory(storyId);
  const out = pages.map((page) => {
    const imagePath = getDefaultImagePath(page.id);
    const fromBook = bookAudio?.pages.find(
      (p) => p.pageNumber === page.page_number
    );
    const segments: HotspotEditorSegment[] = fromBook
      ? fromBook.segments.map((s) => ({
          seq: s.seq,
          textZh: s.textZh,
          textEn: s.textEn,
          speaker: s.speaker,
          speakerEn: s.speakerEn ?? null,
          audioUrls: s.audioUrls,
        }))
      : getSegmentsForPage(page.id).map((s) => ({
          seq: s.seq,
          textZh: s.text_zh,
          textEn: s.text_en,
          speaker: s.speaker,
          speakerEn: s.speaker_en ?? null,
          audioUrls: {},
        }));
    return { pageNumber: page.page_number, imagePath, segments };
  });
  return { pages: out };
}

async function generateBoxesForPage(
  absImage: string,
  segments: Array<{ seq: number; text_zh: string; text_en: string }>
): Promise<VisionBox[]> {
  const segList = segments
    .map((s) => `- seq=${s.seq}: 中文「${s.text_zh}」/ 英文「${s.text_en}」`)
    .join("\n");

  const prompt = `You are placing clickable hotspots on a children's picture-book page.
For EACH text segment below, decide WHERE on the image a child would naturally tap to hear that line read aloud (usually on/near the object or character the line describes).
Return a JSON object with a "hotspots" array. Each item:
- segment_seq: the seq from the list
- x, y: CENTER of the hotspot, normalized 0~1 (0,0 = top-left of image, 1,1 = bottom-right)
- confidence: 0~1 how sure you are the region matches the segment
Note: the hotspot SIZE is auto-computed from the text length (so it hugs the words); you only need to provide the CENTER (x,y) for each segment.
Place hotspots so they do not overlap too much. If a segment has no clear visual target, still give your best guess near the relevant area.

SEGMENTS:
${segList}`;

  try {
    const imagePart = pathToInlineImagePart(absImage);
    const json = await getVisionBackend().generateJSON({
      parts: [imagePart as any, { text: prompt }],
      schema: {
        type: Type.OBJECT,
        properties: {
          hotspots: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                segment_seq: { type: Type.INTEGER },
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                confidence: { type: Type.NUMBER },
              },
              required: ["segment_seq", "x", "y"],
            },
          },
        },
        required: ["hotspots"],
      },
      role: "vision",
    });

    const arr = Array.isArray(json?.hotspots) ? json.hotspots : [];
    const valid = arr
      .filter(
        (b: any) =>
          typeof b?.segment_seq === "number" &&
          segments.some((s) => s.seq === b.segment_seq) &&
          [b.x, b.y].every((n: any) => typeof n === "number")
      )
      .map((b: any) => ({
        segment_seq: Number(b.segment_seq),
        x: Number(b.x),
        y: Number(b.y),
        confidence: typeof b.confidence === "number" ? Number(b.confidence) : undefined,
      }));
    if (valid.length) return valid;
  } catch (err) {
    console.error("AI 热区生成失败，回退网格布局:", err);
  }

  // 兜底：无 VISION / 异常时，按 2 列网格均匀分布（中心坐标）。
  return fallbackGrid(segments);
}

function fallbackGrid(
  segments: Array<{ seq: number }>
): VisionBox[] {
  const cols = 2;
  const rows = Math.max(1, Math.ceil(segments.length / cols));
  return segments.map((s, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const cx = 0.3 + c * 0.4;
    const cy = (r + 0.5) / rows;
    return {
      segment_seq: s.seq,
      x: cx,
      y: cy,
      confidence: 0.4,
    };
  });
}

/**
 * 该故事最近一次热区任务（任意状态）。
 * 用途：页面刷新后恢复按钮状态（进行中 / 可继续 / 已完成），不依赖前端内存态。
 */
export function getLatestHotspotTask(storyId: number): GenerationTask | null {
  const row = db
    .prepare(
      `SELECT * FROM generation_tasks
        WHERE story_id = ? AND kind = 'hotspot'
        ORDER BY id DESC LIMIT 1`
    )
    .get(storyId) as GenerationTask | undefined;
  return row ?? null;
}

/** 该故事是否有进行中的热区任务（避免重复点击导致并发重复生成）。 */
export function getActiveHotspotTaskId(storyId: number): number | null {
  const row = db
    .prepare(
      `SELECT id FROM generation_tasks
        WHERE story_id = ? AND kind = 'hotspot' AND status IN ('queued','running')
        ORDER BY id DESC LIMIT 1`
    )
    .get(storyId) as { id: number } | undefined;
  return row ? Number(row.id) : null;
}

// ===================== 异步任务包装（供 taskRunner 调度） =====================

/**
 * AI 生成热区的任务体：由 routes 建 task 后经 taskRunner 派发，前端轮询 /api/tasks/:id。
 * 崩溃恢复：任务此前已启动过（started_at 有值，说明是重启后重新派发）→ 走 resume，
 * 保留已生成的页、只补缺失页，避免推翻重来。
 */
export async function runHotspotGeneration(taskId: number): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;
  const storyId = task.story_id;

  let params: { regenerate?: boolean } = {};
  try {
    params = JSON.parse(task.params_json || "{}");
  } catch {
    /* ignore */
  }
  // 默认续跑：只补「还没有 AI 热区」的页，已有结果与人工微调全部保留。
  // 只有显式 regenerate=true（前端的「全部重新生成」）才清空 AI 热区重来。
  const resume = params.regenerate !== true;

  setTaskStatus(taskId, "running");
  try {
    const r = await autoGenerateHotspots(storyId, {
      resume,
      taskId,
      onProgress: (done, total) => setTaskProgress(taskId, total, done, 0),
    });
    finishTask(
      taskId,
      "completed",
      r.failed > 0 ? `${r.failed} 页生成失败，可点「继续生成」补跑` : null
    );
  } catch (err: any) {
    finishTask(taskId, "failed", err?.message ?? String(err));
  }
}
