// 故事服务：建故事、改写（safety → refine → parse）、列表、详情。
// 改写逻辑逐字移植自 App.tsx 的 handleGenerateClick 前半段，状态机走 canTransitionStory 守卫。

import path from "node:path";
import { db, DATA_DIR } from "../db/sqlite";
import {
  STORY_STATUS,
  assertStoryTransition,
} from "../constants/status";
import type { CreateStoryInput, Page, Story } from "../types";
import {
  refineStoryForPageCount,
  parseStoryIntoPages,
  safetyCheckText,
} from "./geminiService";
import { saveInspiration } from "../storage/imageStore";

const now = () => new Date().toISOString();

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
}

/** 改写：safety(前) → refine → safety(后) → parse，落 refined_text / pages / safety_result / rewrite_result。 */
export async function rewriteStory(storyId: number): Promise<RewriteResult> {
  const story = getStoryRaw(storyId);
  if (!story) throw new Error(`故事不存在: ${storyId}`);

  // 状态守卫：仅 新建 / 改写完成待生图 可重新改写
  if (
    story.status !== STORY_STATUS.NEW &&
    story.status !== STORY_STATUS.REWRITE_DONE
  ) {
    throw new Error(
      `当前状态(${story.status})不允许改写，需为「新建」或「改写完成待生图」`
    );
  }
  assertStoryTransition(story.status, STORY_STATUS.REWRITING);

  const pageCount = story.target_page_count ?? 6;
  const style = story.style ?? "whimsical, cute, children's picture-book style";
  const inspirationPath = story.inspiration_image_path
    ? pathFromStory(story) // 见下
    : null;

  // 进入改写中
  setStatus(storyId, STORY_STATUS.REWRITING);

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
    const refine = await refineStoryForPageCount(safeInput, pageCount, style);
    let refinedStory = refine.finalStory;
    const { mode, feedback } = refine;

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
    const parsedPages = await parseStoryIntoPages(
      refinedStory,
      inspirationPath,
      pageCount,
      style
    );

    // 落库：先清旧 pages，再写新的
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM pages WHERE story_id = ?`).run(storyId);
      for (const p of parsedPages) {
        db.prepare(
          `INSERT INTO pages (story_id, page_number, text_en, image_prompt)
           VALUES (?, ?, ?, ?)`
        ).run(storyId, p.pageNumber, p.text, p.imagePrompt);
      }
      db.prepare(
        `UPDATE stories
         SET refined_text = ?, safety_result = ?, rewrite_result = ?,
             status = ?, updated_at = ?
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

    return {
      storyId,
      mode,
      feedback,
      pageCount: parsedPages.length,
      safetyNote,
    };
  } catch (err) {
    // 改写失败：回退到「新建」（状态机允许 REWRITING -> 新建）
    setStatus(storyId, STORY_STATUS.NEW);
    throw err;
  }
}

// 把 stories.inspiration_image_path（相对 DATA_DIR）转成绝对路径给 parseStoryIntoPages 用
function pathFromStory(story: Story): string {
  return path.join(DATA_DIR, story.inspiration_image_path as string);
}

export function getStoryRaw(id: number): Story | undefined {
  return db.prepare(`SELECT * FROM stories WHERE id = ?`).get(id) as
    | Story
    | undefined;
}

export function listStories(status?: string): Array<{
  id: number;
  user_title: string | null;
  status: string;
  page_count: number;
  created_at: string | null;
}> {
  // 已发布过滤：reader 书架只请求 status='审批通过的作品'，避免草稿外泄。
  // 无参时行为不变（管理壳兼容）。
  const sql = `SELECT s.id, s.user_title, s.status, s.created_at,
                      (SELECT COUNT(*) FROM pages p WHERE p.story_id = s.id) AS page_count
               FROM stories s
               WHERE s.deleted_at IS NULL${status ? " AND s.status = ?" : ""}
               ORDER BY s.updated_at DESC, s.id DESC`;
  return (status ? db.prepare(sql).all(status) : db.prepare(sql).all()) as any[];
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
  return { story, pages };
}

export function getPagesByStory(id: number): Page[] {
  return db
    .prepare(`SELECT * FROM pages WHERE story_id = ? ORDER BY page_number ASC`)
    .all(id) as Page[];
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
