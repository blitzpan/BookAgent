// 故事服务：建故事、改写（safety → refine → parse）、列表、详情。
// 改写逻辑逐字移植自 App.tsx 的 handleGenerateClick 前半段，状态机走 canTransitionStory 守卫。

import path from "node:path";
import fs from "node:fs";
import { db, DATA_DIR } from "../db/sqlite";
import {
  STORY_STATUS,
  assertStoryTransition,
} from "../constants/status";
import { styleToEnglish } from "../constants/style";
import type { CreateStoryInput, Page, Story } from "../types";
import {
  refineStoryForPageCount,
  parseStoryIntoPages,
  safetyCheckText,
} from "./geminiService";
import { saveInspiration } from "../storage/imageStore";
import {
  DEFAULT_GENERATION_CONFIG,
  applyConfigPatch,
} from "../constants/generationConfig";
import { logger, timer, errMsg } from "../logger";

const now = () => new Date().toISOString();

/** 转义正则特殊字符，避免说话人名字里的标点破坏正则。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 保守剥离「说话人前缀」：对话台词只应含纯台词，说话人已在 speaker 字段。
 * 仅当 speaker 非空且文本确实以「speaker 说/：/:」开头时才剥离，避免误伤
 * （如「妈妈说的话很重要」里虽含"说"但非前缀，不剥）。
 * 英文做通用兜底：句首 "Name:" / "Name said:"（仅首字母大写词）也剥离。
 * 这是 prompt 约束之外的第二道防线，主要用于清洗历史/模型偶发异常数据。
 */
function stripSpeakerPrefix(
  text: string,
  speaker?: string | null,
  speakerEn?: string | null
): string {
  if (!text) return text;
  let t = text;
  if (speaker) {
    const zh = new RegExp(`^${escapeRegExp(speaker)}(说|：|:|\\s)*`);
    t = t.replace(zh, "").trim();
  }
  // 英文说话人：直接用英文名剥离「Name:」前缀（忽略大小写），再走通用兜底。
  if (speakerEn) {
    const enName = new RegExp(`^${escapeRegExp(speakerEn)}(:|\\s)*`, "i");
    t = t.replace(enName, "").trim();
  }
  const en = /^([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,2})(?:\s+said)?:\s*/;
  const m = t.match(en);
  if (m) t = t.slice(m[0].length).trim();
  return t;
}

/** 后端资源相对路径（如 "assets/1/1/101.png"）-> 浏览器可访问的 /assets/... URL。 */
function toAssetUrl(rel?: string | null): string | null {
  if (!rel) return null;
  const stripped = rel.replace(/^assets[/\\]/, "");
  return `/assets/${stripped}`;
}

/**
 * 取某书封面图 URL：该书当前生效版本（current_run_id）第 1 页的默认图。
 * 无版本 / 无图时返回 null，前端回退到标题占位。
 */
export function getCoverUrl(storyId: number, runId: number | null): string | null {
  if (runId == null) return null;
  const row = db
    .prepare(
      `SELECT pi.image_path AS p
       FROM pages pg
       JOIN page_images pi ON pi.page_id = pg.id
       WHERE pg.story_id = ? AND pg.page_number = 1
         AND pi.generation_run_id = ? AND pi.is_default = 1
       LIMIT 1`
    )
    .get(storyId, runId) as { p: string | null } | undefined;
  return toAssetUrl(row?.p ?? null);
}

export interface CreateStoryResult {
  id: number;
  inspiration_image_path?: string;
}

export function createStory(input: CreateStoryInput): CreateStoryResult {
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO stories
          (original_text, style, target_page_count, user_title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.original_text,
        input.style ?? null,
        input.target_page_count ?? 6,
        input.user_title ?? null,
        STORY_STATUS.NEW,
        now(),
        now()
      );
    const id = Number(info.lastInsertRowid);

    // 生图参数落默认配置（后续可在详情页改）
    db.prepare(
      `UPDATE stories SET generation_config = ? WHERE id = ?`
    ).run(JSON.stringify(DEFAULT_GENERATION_CONFIG), id);

    let inspiration_image_path: string | undefined;
    if (input.inspiration_image_path) {
      // 前端传 dataURL 字符串，落盘
      inspiration_image_path = saveInspiration(id, input.inspiration_image_path);
      db.prepare(
        `UPDATE stories SET inspiration_image_path = ?, updated_at = ? WHERE id = ?`
      ).run(inspiration_image_path, now(), id);
    }
    return { id, inspiration_image_path };
  });

  return tx();
}

export interface RewriteResult {
  storyId: number;
  mode: string;
  feedback: string;
  pageCount: number;
  safetyNote: string | null;
  /** 改写时清除的失效热区数量（页数重排后旧热区坐标/label 全部失效） */
  hotspotsRemoved: number;
}

/** 改写：safety(前) → refine → safety(后) → parse，落 refined_text / pages / safety_result / rewrite_result。 */
export async function rewriteStory(storyId: number): Promise<RewriteResult> {
  const story = getStoryRaw(storyId);
  if (!story) throw new Error(`故事不存在: ${storyId}`);

  // 状态守卫：发布前可随时重新改写（含生图完成/部分失败态）。已发布则不可改写（冻结）。
  if (
    story.status !== STORY_STATUS.NEW &&
    story.status !== STORY_STATUS.REWRITE_DONE &&
    story.status !== STORY_STATUS.GEN_DONE &&
    story.status !== STORY_STATUS.GEN_PARTIAL_FAILED
  ) {
    throw new Error(
      `当前状态(${story.status})不允许改写，需为未发布态（新建/改写完成/生图完成/生图部分失败）`
    );
  }
  assertStoryTransition(story.status, STORY_STATUS.REWRITING);

  const pageCount = story.target_page_count ?? 6;
  const style = styleToEnglish(story.style);
  const inspirationPath = story.inspiration_image_path
    ? pathFromStory(story) // 见下
    : null;

  // 进入改写中
  setStatus(storyId, STORY_STATUS.REWRITING);

  const t = timer();
  logger.info("rewrite", "start", {
    storyId,
    pageCount,
    style,
    hasInspiration: Boolean(story.inspiration_image_path),
  });

  let safetyNote: string | null = null;

  try {
    // 0) safety 前
    let safeInput = story.original_text;
    const s0 = await safetyCheckText(safeInput, "check");
    if (!s0.isSafe) {
      const s0b = await safetyCheckText(safeInput, "sanitize");
      if (!s0b.sanitizedText || !s0b.sanitizedText.trim()) {
        throw new Error(`故事被安全策略拦截: ${s0.reasons.join("; ")}`);
      }
      safeInput = s0b.sanitizedText;
      safetyNote = `安全过滤：已调整为适合儿童的内容。原因: ${s0.reasons.join("; ")}`;
    }

    // 1) refine
    const tRefine = timer();
    const refine = await refineStoryForPageCount(safeInput, pageCount, style);
    let refinedStory = refine.finalStory;
    const { mode, feedback } = refine;
    logger.info("rewrite", "refine_done", {
      storyId,
      mode,
      duration_ms: tRefine.elapsedMs(),
    });

    // 1.5) safety 后
    const s1 = await safetyCheckText(refinedStory, "check");
    if (!s1.isSafe) {
      const s1b = await safetyCheckText(refinedStory, "sanitize");
      if (!s1b.sanitizedText || !s1b.sanitizedText.trim()) {
        throw new Error(`改写后故事被安全策略拦截: ${s1.reasons.join("; ")}`);
      }
      refinedStory = s1b.sanitizedText;
      const extra = `改写后也需安全清理: ${s1.reasons.join("; ")}`;
      safetyNote = safetyNote ? `${safetyNote}\n${extra}` : `安全过滤：${extra}`;
    }

    // 2) parse
    const tParse = timer();
    const parsedPages = await parseStoryIntoPages(
      refinedStory,
      inspirationPath,
      pageCount,
      style
    );
    logger.info("rewrite", "parse_done", {
      storyId,
      pageCount: parsedPages.length,
      duration_ms: tParse.elapsedMs(),
    });

    // 改写后页数/分段会重排，旧热区的坐标与 label 全部失效（且 label 是旧文本快照），
    // 故在删除 pages 的同时一并清除旧热区，避免阅读端显示错位的热区。返回数量供前端提示。
    const hotspotCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM page_hotspots WHERE story_id = ?`).get(storyId) as {
        n: number;
      }
    ).n;

    // 落库：先清旧图/旧页/旧分段（否则旧数据悬挂），再写新的 pages + page_segments
    // S18：先取出将被删除的插图路径，事务提交后同步删盘，避免孤儿 png
    const staleImages = db
      .prepare(`SELECT image_path FROM page_images WHERE story_id = ?`)
      .all(storyId) as { image_path: string | null }[];
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM page_images WHERE story_id = ?`).run(storyId);
      db.prepare(`DELETE FROM pages WHERE story_id = ?`).run(storyId);
      db.prepare(`DELETE FROM page_segments WHERE story_id = ?`).run(storyId);
      db.prepare(`DELETE FROM page_hotspots WHERE story_id = ?`).run(storyId);
      for (const p of parsedPages) {
        const info = db
          .prepare(
            `INSERT INTO pages (story_id, page_number, text_en, text_zh, image_prompt)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(storyId, p.pageNumber, p.text, p.textZh, p.imagePrompt);
        const pageId = Number(info.lastInsertRowid);
        const segs = Array.isArray(p.segments) ? p.segments : [];
        segs.forEach((s, i) => {
          db.prepare(
            `INSERT INTO page_segments (page_id, story_id, seq, role, speaker, speaker_en, text_zh, text_en)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            pageId,
            storyId,
            Number(s.seq ?? i + 1),
            s.role ?? "narration",
            s.speaker ?? null,
            s.speakerEn ?? null,
            stripSpeakerPrefix(s.textZh ?? "", s.speaker ?? null, null),
            stripSpeakerPrefix(s.textEn ?? "", s.speakerEn ?? null, s.speakerEn ?? null)
          );
        });
      }
      db.prepare(
        `UPDATE stories
         SET refined_text = ?, safety_result = ?, rewrite_result = ?,
             status = ?, updated_at = ?,
             current_run_id = NULL, selected_audio_set_id = NULL,
             has_audio = 0, has_hotspots = 0
         WHERE id = ?`
      ).run(
        refinedStory,
        JSON.stringify({ passed: true, reasons: s0.reasons }),
        JSON.stringify({ mode, feedback }),
        STORY_STATUS.REWRITE_DONE,
        now(),
        storyId
      );
    });
    tx();

    // S18：删盘（DB 删除成功后），失败只记日志，不影响主流程
    for (const r of staleImages) {
      if (!r.image_path) continue;
      try {
        const abs = path.join(DATA_DIR, r.image_path);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch (e) {
        console.error("删除旧插图文件失败:", r.image_path, e);
      }
    }

    logger.info("rewrite", "success", {
      storyId,
      mode,
      pageCount: parsedPages.length,
      hotspotsRemoved: hotspotCount,
      safetyFiltered: Boolean(safetyNote),
      duration_ms: t.elapsedMs(),
    });

    return {
      storyId,
      mode,
      feedback,
      pageCount: parsedPages.length,
      safetyNote,
      hotspotsRemoved: hotspotCount,
    };
  } catch (err) {
    // 改写失败：回退到「新建」（状态机允许 REWRITING -> 新建）
    logger.error("rewrite", "failure", {
      storyId,
      duration_ms: t.elapsedMs(),
      error: errMsg(err),
    });
    setStatus(storyId, STORY_STATUS.NEW);
    throw err;
  }
}

// 把 stories.inspiration_image_path（相对 DATA_DIR）转成绝对路径给 parseStoryIntoPages 用
function pathFromStory(story: Story): string {
  return path.join(DATA_DIR, story.inspiration_image_path as string);
}

export interface UpdateStoryInput {
  user_title?: string | null;
  style?: string | null;
  target_page_count?: number | null;
  inspiration_image?: string; // 可选 dataURL，传入则覆盖灵感图
  generation_config?: unknown; // 生图参数补丁（部分更新，见 constants/generationConfig）
}

/** 更新故事级配置（标题 / 画风 / 目标页数 / 灵感图）；只影响后续改写与生图。 */
export function updateStory(id: number, input: UpdateStoryInput): Story {
  const story = getStoryRaw(id);
  if (!story) throw new Error(`故事不存在: ${id}`);

  const sets: string[] = [];
  const args: any[] = [];
  if (input.user_title !== undefined) {
    sets.push("user_title = ?");
    args.push(input.user_title);
  }
  if (input.style !== undefined) {
    sets.push("style = ?");
    args.push(input.style);
  }
  if (input.target_page_count !== undefined) {
    sets.push("target_page_count = ?");
    args.push(input.target_page_count);
  }
  if (input.inspiration_image) {
    sets.push("inspiration_image_path = ?");
    args.push(saveInspiration(id, input.inspiration_image));
  }
  if (input.generation_config !== undefined) {
    sets.push("generation_config = ?");
    args.push(
      JSON.stringify(applyConfigPatch(story.generation_config, input.generation_config))
    );
  }
  if (sets.length === 0) return story;

  sets.push("updated_at = ?");
  args.push(now(), id);
  db.prepare(`UPDATE stories SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  return getStoryRaw(id) as Story;
}

export function getStoryRaw(id: number): Story | undefined {
  return db.prepare(`SELECT * FROM stories WHERE id = ?`).get(id) as
    | Story
    | undefined;
}

export interface StoryListFilter {
  title?: string;
  status?: string;
  generated?: "all" | "done" | "none" | "partial";
  audio?: "all" | "done" | "none" | "generating" | "interrupted";
  hotspots?: "all" | "done" | "none";
}

export function listStories(filter?: StoryListFilter): Array<{
  id: number;
  user_title: string | null;
  status: string;
  page_count: number;
  created_at: string | null;
  updated_at: string | null;
  currentRunId: number | null;
  hasAudioSnap: number; // 层快照：是否曾生成配音（不区分次数）
  hasHotspots: number; // 层快照：是否曾配置热区
  selectedAudioSetId: number | null;
  isGenerating: number; // 配音任务进行中
  hasAudioDone: number; // 至少有一组配音 completed
  audioSetCount: number;
  cover_url: string | null;
}> {
  const where: string[] = ["s.deleted_at IS NULL"];
  const params: unknown[] = [];

  if (filter?.title) {
    where.push("s.user_title LIKE ?");
    params.push(`%${filter.title}%`);
  }
  if (filter?.status) {
    where.push("s.status = ?");
    params.push(filter.status);
  }
  if (filter?.generated && filter.generated !== "all") {
    if (filter.generated === "done") {
      where.push("s.current_run_id IS NOT NULL AND s.status != ?");
      params.push("生图部分失败");
    } else if (filter.generated === "none") {
      where.push("s.current_run_id IS NULL");
    } else if (filter.generated === "partial") {
      where.push("s.status = ?");
      params.push("生图部分失败");
    }
  }
  if (filter?.audio && filter.audio !== "all") {
    if (filter.audio === "done") {
      where.push("(SELECT COUNT(*) FROM audio_sets a WHERE a.story_id = s.id AND a.status='completed') > 0");
    } else if (filter.audio === "none") {
      where.push("(SELECT COUNT(*) FROM audio_sets a WHERE a.story_id = s.id) = 0");
    } else if (filter.audio === "generating") {
      where.push("(SELECT COUNT(*) FROM audio_sets a WHERE a.story_id = s.id AND a.status='generating') > 0");
    } else if (filter.audio === "interrupted") {
      where.push("(SELECT COUNT(*) FROM audio_sets a WHERE a.story_id = s.id AND a.status='interrupted') > 0");
    }
  }
  if (filter?.hotspots && filter.hotspots !== "all") {
    where.push(filter.hotspots === "done" ? "COALESCE(s.has_hotspots,0) = 1" : "COALESCE(s.has_hotspots,0) = 0");
  }

  const sql = `SELECT s.id, s.user_title, s.status, s.created_at, s.updated_at,
                      s.current_run_id AS currentRunId,
                      s.has_audio AS hasAudioSnap, s.has_hotspots AS hasHotspots,
                      s.selected_audio_set_id AS selectedAudioSetId,
                      ((SELECT COUNT(*) FROM audio_sets a WHERE a.story_id = s.id AND a.status='generating') > 0) AS isGenerating,
                      ((SELECT COUNT(*) FROM audio_sets a WHERE a.story_id = s.id AND a.status='completed') > 0) AS hasAudioDone,
                      (SELECT COUNT(*) FROM audio_sets a WHERE a.story_id = s.id) AS audioSetCount,
                      (SELECT COUNT(*) FROM pages p WHERE p.story_id = s.id) AS page_count
               FROM stories s
               WHERE ${where.join(" AND ")}
               ORDER BY s.updated_at DESC, s.id DESC`;
  const rows = db.prepare(sql).all(...params) as any[];
  // 计算真实封面 URL（当前生效版本第 1 页默认图），供前端书架直接展示。
  return rows.map((r: any) => ({ ...r, cover_url: getCoverUrl(r.id, r.currentRunId ?? null) }));
}

export function getStoryDetail(id: number): {
  story: Story;
  pages: Page[];
} | null {
  const story = getStoryRaw(id);
  if (!story) return null;
  const pages = db
    .prepare(`SELECT * FROM pages WHERE story_id = ? ORDER BY page_number ASC`)
    .all(id) as Page[];
  // 详情故事对象附带封面 URL，便于前端详情页/分享卡片直接取用。
  return { story: { ...story, cover_url: getCoverUrl(id, story.current_run_id) }, pages };
}

export function getPagesByStory(id: number): Page[] {
  return db
    .prepare(`SELECT * FROM pages WHERE story_id = ? ORDER BY page_number ASC`)
    .all(id) as Page[];
}

/** 全故事分段总数（用于配音成本预估，S17）。 */
export function getSegmentCount(storyId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM page_segments WHERE story_id = ?`)
    .get(storyId) as { c: number };
  return row.c;
}

/** 发布前的资产完整性快照：缺什么列什么，供发布闸门与前端发布检查清单共用。 */
export interface PublishReadiness {
  /** 总页数 */
  pages: number;
  /** 缺默认图的页码（按当前生效版本判定） */
  images: number[];
  /** 缺中英任一文本的页码（空字符串按缺失处理：模型漏字段时会写入空串而非 NULL） */
  texts: number[];
  /** true = 缺配音（没有「已选用且已完成」的配音方案） */
  audio: boolean;
  /** 尚无热区的页码 */
  hotspots: number[];
}

export function getPublishReadiness(id: number): PublishReadiness {
  const story = getStoryRaw(id);
  const runId = story?.current_run_id ?? null;
  const pages = getPagesByStory(id);

  const images: number[] = [];
  const texts: number[] = [];
  for (const p of pages) {
    // 默认图按当前版本判定：与 reader 取图口径保持一致。
    // 注意 db.prepare() 返回的语句 get() 后会自行 free，必须每次重新 prepare，不可跨迭代复用。
    const ok =
      runId != null &&
      db
        .prepare(
          `SELECT 1 AS ok FROM page_images
            WHERE page_id = ? AND generation_run_id = ? AND is_default = 1 LIMIT 1`
        )
        .get(p.id, runId) !== undefined;
    if (!ok) images.push(p.page_number);
    if (!(p.text_zh ?? "").trim() || !(p.text_en ?? "").trim()) {
      texts.push(p.page_number);
    }
  }

  const audioReady =
    db
      .prepare(
        `SELECT 1 AS ok FROM audio_sets
          WHERE story_id = ? AND is_selected = 1 AND status = 'completed' LIMIT 1`
      )
      .get(id) !== undefined;

  const covered = new Set(
    (
      db
        .prepare(`SELECT DISTINCT page_number FROM page_hotspots WHERE story_id = ?`)
        .all(id) as Array<{ page_number: number }>
    ).map((r) => Number(r.page_number))
  );

  return {
    pages: pages.length,
    images,
    texts,
    audio: !audioReady,
    hotspots: pages
      .map((p) => p.page_number)
      .filter((n) => !covered.has(n)),
  };
}

/** 设置当前生效版本（整书 run）。 */
export function setCurrentRun(id: number, runId: number | null): void {
  db.prepare(
    `UPDATE stories SET current_run_id = ?, updated_at = ? WHERE id = ?`
  ).run(runId, now(), id);
}

export function setStatus(id: number, to: string): void {
  const story = getStoryRaw(id);
  if (!story) throw new Error(`故事不存在: ${id}`);
  assertStoryTransition(story.status, to);
  db.prepare(`UPDATE stories SET status = ?, updated_at = ? WHERE id = ?`).run(
    to,
    now(),
    id
  );
}

export function softDelete(id: number): void {
  const story = getStoryRaw(id);
  if (!story) throw new Error(`故事不存在: ${id}`);
  assertStoryTransition(story.status, STORY_STATUS.DELETED);
  db.prepare(
    `UPDATE stories SET status = ?, deleted_at = ?, updated_at = ? WHERE id = ?`
  ).run(STORY_STATUS.DELETED, now(), now(), id);
}
