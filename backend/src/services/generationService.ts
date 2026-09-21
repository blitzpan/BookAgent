// 生图编排服务（后端端口，忠实移植 App.tsx 的闭环逻辑）：
//  - 整书 run：抽角色/锚图 → 逐页「生成 + 安全 + 身份 Director + 帧 Director」重试 → 序列 Director 评分 + 必要时全局修复
//  - 单页 run：对某页追加候选图（不翻默认）
// 所有落库均在离散节点（每生成一张候选图即存一张），便于宕机续跑（见 taskRunner）。

import { db } from "../db/sqlite";
import { STORY_STATUS } from "../constants/status";
import {
  getStoryRaw,
  getPagesByStory,
  setStatus,
} from "./storyService";
import {
  ensureAnchors,
  loadSheetMap,
} from "./characterService";
import {
  generateImage,
  safetyCheckImage,
  directorCheckIdentity,
  directorCheckFrame,
  directorCheckSequence,
} from "./geminiService";
import type {
  DirectorSequenceResult,
} from "./geminiService";
import { savePageImage, readDataUrl } from "../storage/imageStore";
import type {
  GenerateConfig,
  GenerationRun,
  ImageKind,
  Page,
  RunScope,
  RunStatus,
  StoryPage,
} from "../types";

const now = () => new Date().toISOString();

const SAFETY_SUFFIX =
  "\nCHILD-SAFE ONLY: no nudity, no sexual content, no suggestive themes, no adult romance, no violence, no gore.";

// ===================== run 生命周期 =====================

export function getRun(runId: number): GenerationRun | undefined {
  return db
    .prepare(`SELECT * FROM generation_runs WHERE id = ?`)
    .get(runId) as GenerationRun | undefined;
}

export function createRun(
  storyId: number,
  scope: RunScope,
  targetPageId: number | null,
  cfg: GenerateConfig
): number {
  const info = db
    .prepare(
      `INSERT INTO generation_runs
        (story_id, scope, target_page_id, status, frame_threshold, max_frame_retry,
         sequence_threshold, max_sequence_retry, initial_retry_budget,
         text_provider, image_provider, vision_provider, aspect_ratio, image_size, created_at)
       VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      storyId,
      scope,
      targetPageId,
      cfg.frame_threshold ?? 0.75,
      cfg.max_frame_retry ?? 3,
      cfg.sequence_threshold ?? 0.8,
      cfg.max_sequence_retry ?? 1,
      cfg.initial_retry_budget ?? 1,
      cfg.text_provider ?? null,
      cfg.image_provider ?? null,
      cfg.vision_provider ?? null,
      cfg.aspect_ratio ?? null,
      cfg.image_size ?? null,
      now()
    );
  return Number(info.lastInsertRowid);
}

export function setRunStatus(runId: number, status: RunStatus): void {
  if (status === "running") {
    db.prepare(
      `UPDATE generation_runs SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`
    ).run(status, now(), runId);
  } else {
    db.prepare(
      `UPDATE generation_runs SET status = ?, finished_at = ? WHERE id = ?`
    ).run(status, now(), runId);
  }
}

export function setRunProgress(
  runId: number,
  total: number,
  done: number,
  failed: number
): void {
  db.prepare(
    `UPDATE generation_runs SET progress = ?, status = 'running' WHERE id = ?`
  ).run(JSON.stringify({ total, done, failed }), runId);
}

export function finishRun(
  runId: number,
  status: RunStatus,
  lastError: string | null
): void {
  db.prepare(
    `UPDATE generation_runs SET status = ?, finished_at = ?, last_error = ? WHERE id = ?`
  ).run(status, now(), lastError, runId);
}

export function setRunFailed(runId: number, msg: string): void {
  db.prepare(
    `UPDATE generation_runs SET status = 'failed', finished_at = ?, last_error = ? WHERE id = ?`
  ).run(now(), msg, runId);
}

export function listRunsForStory(storyId: number): GenerationRun[] {
  return db
    .prepare(
      `SELECT * FROM generation_runs WHERE story_id = ? ORDER BY id DESC`
    )
    .all(storyId) as GenerationRun[];
}

export function getRunDetail(runId: number): any | null {
  const run = getRun(runId);
  if (!run) return null;
  const characters = db
    .prepare(
      `SELECT id, char_key, name, visual_description, sheet_image_path
       FROM characters WHERE generation_run_id = ? ORDER BY id ASC`
    )
    .all(run.id) as any[];
  const pages = db
    .prepare(`SELECT * FROM pages WHERE story_id = ? ORDER BY page_number ASC`)
    .all(run.story_id) as Page[];
  const pageDetails = pages.map((p) => {
    const images = db
      .prepare(
        `SELECT id, is_default, kind, combined_score, identity_score, frame_score,
                image_path, attempt_index, created_at
         FROM page_images WHERE page_id = ? ORDER BY attempt_index ASC, id ASC`
      )
      .all(p.id) as any[];
    const def = images.find((i: any) => i.is_default);
    return { page: p, default_image: def ?? null, candidates: images };
  });
  const sequence_checks = db
    .prepare(
      `SELECT * FROM sequence_checks WHERE generation_run_id = ? ORDER BY id ASC`
    )
    .all(run.id) as any[];
  return { run, characters, pages: pageDetails, sequence_checks };
}

export function recoverRuns(): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM generation_runs WHERE status IN ('queued','running')`
    )
    .all() as { id: number }[];
  return rows.map((r) => r.id);
}

// ===================== 图片落库辅助 =====================

function recordImage(opts: {
  storyId: number;
  pageId: number;
  runId: number;
  kind: ImageKind;
  prompt: string;
  refCharKeys: string[];
  dataUrl: string;
  identityScore: number;
  identityIssues: string[];
  frameScore: number;
  frameIssues: string[];
  combinedScore: number;
  safetyPassed: number;
  attemptIndex: number;
}): number {
  const info = db
    .prepare(
      `INSERT INTO page_images
        (page_id, story_id, generation_run_id, is_default, kind, prompt_used,
         reference_sheet_ids, image_path, identity_score, identity_issues,
         frame_score, frame_issues, combined_score, safety_passed, attempt_index, created_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      opts.pageId,
      opts.storyId,
      opts.runId,
      opts.kind,
      opts.prompt,
      JSON.stringify(opts.refCharKeys),
      opts.identityScore,
      JSON.stringify(opts.identityIssues),
      opts.frameScore,
      JSON.stringify(opts.frameIssues),
      opts.combinedScore,
      opts.safetyPassed,
      opts.attemptIndex,
      now()
    );
  const id = Number(info.lastInsertRowid);
  const relPath = savePageImage(opts.storyId, opts.pageId, id, opts.dataUrl);
  db.prepare(`UPDATE page_images SET image_path = ? WHERE id = ?`).run(
    relPath,
    id
  );
  return id;
}

export function setDefaultImageForPage(pageId: number, imageId: number): void {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE page_images SET is_default = 0 WHERE page_id = ?`).run(
      pageId
    );
    db.prepare(`UPDATE page_images SET is_default = 1 WHERE id = ?`).run(imageId);
  });
  tx();
}

export function getPageImages(pageId: number): any[] {
  return db
    .prepare(
      `SELECT id, is_default, kind, combined_score, identity_score, frame_score,
              image_path, attempt_index, created_at
       FROM page_images WHERE page_id = ? ORDER BY attempt_index ASC, id ASC`
    )
    .all(pageId) as any[];
}

export function getDefaultImageDataUrl(pageId: number): string | null {
  const row = db
    .prepare(
      `SELECT image_path FROM page_images WHERE page_id = ? AND is_default = 1 LIMIT 1`
    )
    .get(pageId) as { image_path: string } | undefined;
  if (!row?.image_path) return null;
  try {
    return readDataUrl(row.image_path);
  } catch {
    return null;
  }
}

// ===================== 一致性辅助（移植自 App.tsx） =====================

type MiniPage = { text: string; imagePrompt: string };

function detectCharacterIdsForPageExplicit(
  page: MiniPage,
  chars: ExtractedLike[]
): string[] {
  if (!chars || chars.length === 0) return [];
  const hay = `${page.text}\n${page.imagePrompt}`.toLowerCase();
  const hits = chars
    .filter((c) => c.name && hay.includes(c.name.toLowerCase()))
    .map((c) => c.id);
  return Array.from(new Set(hits)).slice(0, 5);
}

function getPageCharacterIds(
  index: number,
  pages: MiniPage[],
  chars: ExtractedLike[]
): string[] {
  if (!chars.length) return [];
  const mainId = chars[0]?.id;
  const page = pages[index];
  const detected = detectCharacterIdsForPageExplicit(page, chars);
  let fallback: string[] = [];
  if (detected.length === 0 && index > 0) {
    fallback = detectCharacterIdsForPageExplicit(pages[index - 1], chars);
  }
  const ids = Array.from(
    new Set([mainId, ...(detected.length ? detected : fallback)].filter(Boolean))
  ) as string[];
  return ids.length
    ? ids.slice(0, 5)
    : mainId
    ? [mainId]
    : [chars[0].id];
}

function getCharacterLockText(
  charIds: string[],
  chars: ExtractedLike[]
): string {
  const lines = charIds
    .map((id) => chars.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => `- ${c!.name}: ${c!.visualDescription}`);
  return lines.join("\n");
}

function buildRefsForPage(
  charIds: string[],
  sheetMap: Map<string, string>
): string[] {
  const refs: string[] = [];
  for (const id of charIds) {
    const sheet = sheetMap.get(id);
    if (sheet) refs.push(sheet);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs) {
    if (!r) continue;
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
    if (out.length >= 14) break;
  }
  return out;
}

function buildBasePrompt(
  imagePrompt: string,
  charIds: string[],
  chars: ExtractedLike[],
  style: string,
  extraHint?: string
): string {
  return (
    `${imagePrompt}

CHARACTER LOCK (must match reference sheets exactly):
${getCharacterLockText(charIds, chars)}

REFERENCE USAGE:
- All reference images are CHARACTER SHEETS. Match character identity exactly.

PRIORITY: If any text conflicts with the references, follow the references for character appearance (species, fur color, clothing).
HARD RULE: Do NOT include any recurring characters unless explicitly mentioned on this page.` +
    SAFETY_SUFFIX +
    (extraHint ? `\n${extraHint}` : "")
  );
}

interface ExtractedLike {
  id: string;
  name: string;
  visualDescription: string;
}

interface GenContext {
  storyId: number;
  runId: number;
  style: string;
  extracted: ExtractedLike[];
  sheetMap: Map<string, string>;
  aspectRatio: string;
  frameThreshold: number;
  frameBudget: number;
  globalHint: string;
  /** 续跑幂等：true 时本 run 已有默认图的页直接跳过（宕机恢复）；一致性修复阶段置 false。 */
  skipExisting: boolean;
}

interface FrameLoopResult {
  bestRowId: number | null;
  bestScore: number;
  issues: string[];
  imageUrl: string | null;
}

/**
 * 单页「生成 + 安全 + 身份 + 帧」重试闭环（移植 App.tsx 内层循环）。
 * flipDefault=true 时把最佳候选翻为该页默认图；false 时仅追加候选（用于单页补画）。
 */
async function runFrameLoop(
  page: Page,
  index: number,
  pagesText: MiniPage[],
  ctx: GenContext,
  flipDefault: boolean
): Promise<FrameLoopResult> {
  const charIds = getPageCharacterIds(index, pagesText, ctx.extracted);

  // 续跑幂等（设计 §4.3）：本 run 该页已有默认图则直接跳过，不重复生图、不污染候选区。
  if (ctx.skipExisting) {
    const existing = db
      .prepare(
        `SELECT id, combined_score FROM page_images WHERE generation_run_id = ? AND page_id = ? AND is_default = 1 LIMIT 1`
      )
      .get(ctx.runId, page.id) as any;
    if (existing) {
      return {
        bestRowId: existing.id,
        bestScore: Number(existing.combined_score ?? 0),
        issues: [],
        imageUrl: null,
      };
    }
  }

  let basePrompt = buildBasePrompt(
    page.image_prompt || "",
    charIds,
    ctx.extracted,
    ctx.style,
    ctx.globalHint
  );
  const seenFixes = new Set<string>();
  let bestRowId: number | null = null;
  let bestScore = -1;
  let bestIssues: string[] = [];
  let bestUrl: string | null = null;

  for (let attempt = 1; attempt <= ctx.frameBudget; attempt++) {
    const refs = buildRefsForPage(charIds, ctx.sheetMap);
    let imageUrl: string;
    try {
      imageUrl = await generateImage(basePrompt, refs, {
        aspectRatio: ctx.aspectRatio,
      });
    } catch (err) {
      // 生图失败（如缺 key / 限流）：停止本页重试，标记失败
      break;
    }

    const imgSafe = await safetyCheckImage(imageUrl);
    if (!imgSafe.isSafe) {
      const reason = imgSafe.reasons.slice(0, 2).join("; ") || "unsafe";
      basePrompt +=
        `\nSAFETY REPAIR: Ensure child-safe content only. Avoid anything suggestive. (${reason})`;
      continue;
    }

    const identitySheets = charIds
      .map((id) => {
        const c = ctx.extracted.find((x) => x.id === id);
        const d = ctx.sheetMap.get(id);
        return c && d
          ? { name: c.name, visualDescription: c.visualDescription, dataUrl: d }
          : null;
      })
      .filter(Boolean) as {
      name: string;
      visualDescription: string;
      dataUrl: string;
    }[];

    const identityResult = await directorCheckIdentity({
      pageNumber: page.page_number,
      pageText: page.text_en || "",
      generatedImageUrl: imageUrl,
      characterSheets: identitySheets,
      style: ctx.style,
    });

    const frameResult = await directorCheckFrame({
      pageNumber: page.page_number,
      text: page.text_en || "",
      imagePrompt: page.image_prompt || "",
      imageUrl,
    });

    const combinedScore = Math.min(
      Number(frameResult.score ?? 0),
      Number(identityResult.score ?? 0)
    );
    const combinedIssues = Array.from(
      new Set(
        [...(identityResult.issues ?? []), ...(frameResult.issues ?? [])].map(
          String
        )
      )
    );

    const rowId = recordImage({
      storyId: ctx.storyId,
      pageId: page.id,
      runId: ctx.runId,
      kind: attempt === 1 ? "initial" : "retry",
      prompt: basePrompt,
      refCharKeys: charIds,
      dataUrl: imageUrl,
      identityScore: Number(identityResult.score ?? 0),
      identityIssues: identityResult.issues ?? [],
      frameScore: Number(frameResult.score ?? 0),
      frameIssues: frameResult.issues ?? [],
      combinedScore,
      safetyPassed: 1,
      attemptIndex: attempt,
    });

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestRowId = rowId;
      bestIssues = combinedIssues;
      bestUrl = imageUrl;
    }

    if (combinedScore >= ctx.frameThreshold) break;

    if (combinedIssues.length) {
      const trimmed = combinedIssues.slice(0, 4).join("; ");
      if (!seenFixes.has(trimmed)) {
        seenFixes.add(trimmed);
        basePrompt +=
          `\nFIX (based on director): ${trimmed}.` +
          `\nBe literal: match the page text AND keep character identity exactly matching the reference sheets.` +
          `\nDo not change fur colors/markings/clothing. Do not add extra objects or scenes not mentioned.`;
      } else {
        basePrompt +=
          `\nBe more literal and accurate. Keep composition simple and clearly depict the stated action.` +
          ` Keep all characters' appearances identical to the reference sheets.`;
      }
    }
  }

  if (flipDefault && bestRowId != null) {
    setDefaultImageForPage(page.id, bestRowId);
  }
  return { bestRowId, bestScore, issues: bestIssues, imageUrl: bestUrl };
}

function buildSequencePages(pages: Page[]): StoryPage[] {
  const out: StoryPage[] = [];
  for (const p of pages) {
    const du = getDefaultImageDataUrl(p.id);
    if (du) {
      out.push({
        pageNumber: p.page_number,
        text: p.text_en || "",
        imagePrompt: p.image_prompt || "",
        imageUrl: du,
      });
    }
  }
  return out;
}

function insertSequenceCheck(
  runId: number,
  storyId: number,
  r: DirectorSequenceResult
): void {
  db.prepare(
    `INSERT INTO sequence_checks
      (story_id, generation_run_id, is_consistent, score, issues, problem_pages)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    storyId,
    runId,
    r.isConsistent ? 1 : 0,
    r.score,
    JSON.stringify(r.issues || []),
    JSON.stringify(r.problemPages || [])
  );
}

// ===================== 两类 run 的执行 =====================

export async function runFullGeneration(runId: number): Promise<void> {
  const run = getRun(runId);
  if (!run) return;
  const story = getStoryRaw(run.story_id);
  if (!story) {
    finishRun(runId, "failed", "story not found");
    return;
  }
  setRunStatus(runId, "running");

  try {
    const pages = getPagesByStory(story.id);
    if (!pages.length) throw new Error("该故事尚无分页，请先执行改写");

    const style = story.style || "whimsical, cute, children's picture-book style";
    const sourceText = story.refined_text || story.original_text;

    const { extracted } = await ensureAnchors(
      story.id,
      run.id,
      style,
      sourceText
    );
    // ensureAnchors 已落库锚图，重新读取 dataURL 映射
    const sheetMap = loadSheetMap(story.id);

    const ctx: GenContext = {
      storyId: story.id,
      runId: run.id,
      style,
      extracted,
      sheetMap,
      aspectRatio: run.aspect_ratio || "4:3",
      frameThreshold: run.frame_threshold ?? 0.75,
      frameBudget: run.initial_retry_budget ?? 1,
      globalHint: "",
      skipExisting: true,
    };

    const pagesText: MiniPage[] = pages.map((p) => ({
      text: p.text_en || "",
      imagePrompt: p.image_prompt || "",
    }));

    let done = 0;
    let failed = 0;
    const frameIssuesAll: string[] = [];

    for (let i = 0; i < pages.length; i++) {
      const r = await runFrameLoop(pages[i], i, pagesText, ctx, true);
      if (r.bestRowId != null) done++;
      else failed++;
      if (r.issues.length) {
        frameIssuesAll.push(
          `Page ${pages[i].page_number}: ${r.issues.join("; ")}`
        );
      }
      setRunProgress(run.id, pages.length, done, failed);
    }

    // 序列一致性评分（仅评估已有默认图的页）
    const seqPages = buildSequencePages(pages);
    const seqThreshold = run.sequence_threshold ?? 0.8;
    ctx.skipExisting = false; // 一致性修复阶段需重新生图，关闭幂等跳过
    if (seqPages.length > 0) {
      let seqResult = await directorCheckSequence(seqPages, style);
      insertSequenceCheck(run.id, story.id, seqResult);

      const maxRepair = run.max_sequence_retry ?? 1;
      for (let round = 1; round <= maxRepair; round++) {
        if (seqResult.score >= seqThreshold) break;
        const problemSet = new Set(seqResult.problemPages || []);
        ctx.globalHint =
          "IMPORTANT: Keep the main character and overall color palette consistent with earlier pages. Match the main character's species, approximate age, main clothing, and dominant colors from previous pages.";
        ctx.frameBudget = 2;
        for (let i = 0; i < pages.length; i++) {
          if (problemSet.size > 0 && !problemSet.has(pages[i].page_number)) {
            continue;
          }
          await runFrameLoop(pages[i], i, pagesText, ctx, true);
        }
        seqResult = await directorCheckSequence(buildSequencePages(pages), style);
        insertSequenceCheck(run.id, story.id, seqResult);
        if (seqResult.score >= seqThreshold) break;
      }
    }

    const status: RunStatus = failed > 0 ? "partial_failed" : "completed";
    finishRun(run.id, status, null);
    try {
      setStatus(
        story.id,
        status === "completed"
          ? STORY_STATUS.GEN_DONE
          : STORY_STATUS.GEN_PARTIAL_FAILED
      );
    } catch {
      // 状态机冲突（如已被人工改动）忽略
    }
  } catch (err: any) {
    finishRun(run.id, "failed", err?.message ?? String(err));
    try {
      setStatus(story.id, STORY_STATUS.GEN_PARTIAL_FAILED);
    } catch {
      /* ignore */
    }
  }
}

export async function runSinglePage(runId: number): Promise<void> {
  const run = getRun(runId);
  if (!run) return;
  const pageId = run.target_page_id;
  if (!pageId) {
    finishRun(runId, "failed", "no target page");
    return;
  }
  const page = db
    .prepare(`SELECT * FROM pages WHERE id = ?`)
    .get(pageId) as Page | undefined;
  if (!page) {
    finishRun(runId, "failed", "page not found");
    return;
  }
  const story = getStoryRaw(run.story_id);
  if (!story) {
    finishRun(runId, "failed", "story not found");
    return;
  }
  setRunStatus(runId, "running");

  try {
    const style = story.style || "whimsical, cute, children's picture-book style";
    const sourceText = story.refined_text || story.original_text;
    const { extracted } = await ensureAnchors(
      story.id,
      run.id,
      style,
      sourceText
    );
    const sheetMap = loadSheetMap(story.id);

    const ctx: GenContext = {
      storyId: story.id,
      runId: run.id,
      style,
      extracted,
      sheetMap,
      aspectRatio: run.aspect_ratio || "4:3",
      frameThreshold: run.frame_threshold ?? 0.75,
      frameBudget: run.max_frame_retry ?? 3,
      globalHint: "",
      skipExisting: false,
    };

    const pages = getPagesByStory(story.id);
    const pagesText: MiniPage[] = pages.map((p) => ({
      text: p.text_en || "",
      imagePrompt: p.image_prompt || "",
    }));
    const idx = pages.findIndex((p) => p.id === pageId);

    // 单页补画：不翻默认（flipDefault=false），仅追加候选
    const r = await runFrameLoop(
      page,
      idx >= 0 ? idx : 0,
      pagesText,
      ctx,
      false
    );
    finishRun(run.id, r.bestRowId != null ? "completed" : "partial_failed", null);
    // 单页补画不改变故事整体状态
  } catch (err: any) {
    finishRun(run.id, "failed", err?.message ?? String(err));
  }
}
