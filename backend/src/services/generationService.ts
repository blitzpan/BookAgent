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
import {
  DEFAULT_GENERATION_CONFIG,
  type GenerationConfig,
} from "../constants/generationConfig";
import { getProviderNames } from "../providers";
import type {
  GenerationRun,
  GenerationTask,
  ImageKind,
  Page,
  RunStatus,
  StoryPage,
  TaskKind,
  TaskStatus,
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

/** 建一次整书生成的版本记录：版本参数快照 + 实际生效 provider 落库。 */
export function createRun(storyId: number, cfg: GenerationConfig): number {
  const providers = getProviderNames();
  const info = db
    .prepare(
      `INSERT INTO generation_runs
        (story_id, status, frame_threshold, max_frame_retry,
         sequence_threshold, max_sequence_retry, initial_retry_budget,
         text_provider, image_provider, vision_provider, aspect_ratio, image_size, created_at)
       VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      storyId,
      cfg.frame_threshold ?? DEFAULT_GENERATION_CONFIG.frame_threshold,
      cfg.max_frame_retry ?? DEFAULT_GENERATION_CONFIG.max_frame_retry,
      cfg.sequence_threshold ?? DEFAULT_GENERATION_CONFIG.sequence_threshold,
      cfg.max_sequence_retry ?? DEFAULT_GENERATION_CONFIG.max_sequence_retry,
      cfg.initial_retry_budget ?? DEFAULT_GENERATION_CONFIG.initial_retry_budget,
      providers.text,
      providers.image,
      providers.vision,
      cfg.aspect_ratio ?? DEFAULT_GENERATION_CONFIG.aspect_ratio,
      cfg.image_size ?? DEFAULT_GENERATION_CONFIG.image_size,
      now()
    );
  return Number(info.lastInsertRowid);
}

export function setRunStatus(runId: number, status: RunStatus): void {
  if (status === "running") {
    // 续跑：回到 running 时清空 finished_at，避免残留上一次的结束时间
    db.prepare(
      `UPDATE generation_runs
         SET status = ?, started_at = COALESCE(started_at, ?), finished_at = NULL
       WHERE id = ?`
    ).run(status, now(), runId);
  } else {
    db.prepare(
      `UPDATE generation_runs SET status = ?, finished_at = ? WHERE id = ?`
    ).run(status, now(), runId);
  }
}

export function finishRun(runId: number, status: RunStatus): void {
  db.prepare(
    `UPDATE generation_runs SET status = ?, finished_at = ? WHERE id = ?`
  ).run(status, now(), runId);
}

// ===================== task（执行）生命周期 =====================

export function createTask(
  storyId: number,
  runId: number,
  pageId: number | null,
  kind: TaskKind,
  params: GenerationConfig
): number {
  const info = db
    .prepare(
      `INSERT INTO generation_tasks
        (story_id, run_id, page_id, kind, status, params_json, created_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?)`
    )
    .run(storyId, runId, pageId, kind, JSON.stringify(params), now());
  return Number(info.lastInsertRowid);
}

export function getTask(taskId: number): GenerationTask | undefined {
  return db
    .prepare(`SELECT * FROM generation_tasks WHERE id = ?`)
    .get(taskId) as GenerationTask | undefined;
}

export function setTaskStatus(taskId: number, status: TaskStatus): void {
  if (status === "running") {
    db.prepare(
      `UPDATE generation_tasks SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`
    ).run(status, now(), taskId);
  } else {
    db.prepare(
      `UPDATE generation_tasks SET status = ?, finished_at = ? WHERE id = ?`
    ).run(status, now(), taskId);
  }
}

export function setTaskProgress(
  taskId: number,
  total: number,
  done: number,
  failed: number
): void {
  db.prepare(
    `UPDATE generation_tasks SET progress = ?, status = 'running' WHERE id = ?`
  ).run(JSON.stringify({ total, done, failed }), taskId);
}

export function finishTask(
  taskId: number,
  status: "completed" | "failed",
  lastError: string | null = null
): void {
  db.prepare(
    `UPDATE generation_tasks SET status = ?, finished_at = ?, last_error = ? WHERE id = ?`
  ).run(status, now(), lastError, taskId);
}

/** 同一版本同一类任务只允许一个进行中（并发去重）。 */
export function getActiveTask(
  runId: number,
  kind: TaskKind,
  pageId: number | null = null
): GenerationTask | undefined {
  if (kind === "single_page" && pageId != null) {
    return db
      .prepare(
        `SELECT * FROM generation_tasks
          WHERE run_id = ? AND kind = ? AND page_id = ? AND status IN ('queued','running')
          ORDER BY id DESC LIMIT 1`
      )
      .get(runId, kind, pageId) as GenerationTask | undefined;
  }
  return db
    .prepare(
      `SELECT * FROM generation_tasks
        WHERE run_id = ? AND kind = ? AND status IN ('queued','running')
        ORDER BY id DESC LIMIT 1`
    )
    .get(runId, kind) as GenerationTask | undefined;
}

/** 故事是否存在进行中的任务（用于生图期间锁定配置）。 */
export function hasActiveTaskForStory(storyId: number): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM generation_tasks
        WHERE story_id = ? AND status IN ('queued','running')`
    )
    .get(storyId) as { c: number } | undefined;
  return (row?.c ?? 0) > 0;
}

/** 启动续跑：把未完成的任务重新派发（执行状态在 task，不在 run）。 */
export function recoverTasks(): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM generation_tasks WHERE status IN ('queued','running')`
    )
    .all() as { id: number }[];
  return rows.map((r) => r.id);
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
  // 默认图与候选图都按 run 隔离：一页在不同版本各有自己的默认图
  const pageDetails = pages.map((p) => {
    const images = db
      .prepare(
        `SELECT id, is_default, kind, combined_score, identity_score, frame_score,
                image_path, attempt_index, generation_run_id, task_id, created_at
         FROM page_images
         WHERE page_id = ? AND generation_run_id = ?
         ORDER BY attempt_index ASC, id ASC`
      )
      .all(p.id, run.id) as any[];
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

export function listTasksForStory(storyId: number): GenerationTask[] {
  return db
    .prepare(
      `SELECT * FROM generation_tasks WHERE story_id = ? ORDER BY id DESC`
    )
    .all(storyId) as GenerationTask[];
}

// ===================== 图片落库辅助 =====================

function recordImage(opts: {
  storyId: number;
  pageId: number;
  runId: number;
  taskId: number;
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
        (page_id, story_id, generation_run_id, task_id, is_default, kind, prompt_used,
         reference_sheet_ids, image_path, identity_score, identity_issues,
         frame_score, frame_issues, combined_score, safety_passed, attempt_index, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      opts.pageId,
      opts.storyId,
      opts.runId,
      opts.taskId,
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

/** 设置某页的默认图：只在该图所属版本内切换（不同版本各有自己的默认图）。 */
export function setDefaultImageForPage(pageId: number, imageId: number): void {
  const row = db
    .prepare(`SELECT generation_run_id FROM page_images WHERE id = ?`)
    .get(imageId) as { generation_run_id: number } | undefined;
  if (!row) return;
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE page_images SET is_default = 0 WHERE page_id = ? AND generation_run_id = ?`
    ).run(pageId, row.generation_run_id);
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

export function getDefaultImageDataUrl(pageId: number, runId: number): string | null {
  const row = db
    .prepare(
      `SELECT image_path FROM page_images
        WHERE page_id = ? AND generation_run_id = ? AND is_default = 1 LIMIT 1`
    )
    .get(pageId, runId) as { image_path: string } | undefined;
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
  taskId: number;
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
      taskId: ctx.taskId,
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

function buildSequencePages(pages: Page[], runId: number): StoryPage[] {
  const out: StoryPage[] = [];
  for (const p of pages) {
    const du = getDefaultImageDataUrl(p.id, runId);
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

// ===================== 两类任务的执行（以 task 为驱动） =====================

export async function runFullGeneration(taskId: number): Promise<void> {
  const task = getTask(taskId);
  if (!task || !task.run_id) return;
  const run = getRun(task.run_id);
  if (!run) {
    finishTask(taskId, "failed", "run not found");
    return;
  }
  const story = getStoryRaw(run.story_id);
  if (!story) {
    finishTask(taskId, "failed", "story not found");
    finishRun(run.id, "failed");
    return;
  }
  setTaskStatus(taskId, "running");
  setRunStatus(run.id, "running");

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
      taskId,
      style,
      extracted,
      sheetMap,
      aspectRatio: run.aspect_ratio || DEFAULT_GENERATION_CONFIG.aspect_ratio,
      frameThreshold: run.frame_threshold ?? DEFAULT_GENERATION_CONFIG.frame_threshold,
      frameBudget: run.initial_retry_budget ?? DEFAULT_GENERATION_CONFIG.initial_retry_budget,
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
      setTaskProgress(taskId, pages.length, done, failed);
    }

    // 序列一致性评分（仅评估已有默认图的页）
    const seqPages = buildSequencePages(pages, run.id);
    const seqThreshold = run.sequence_threshold ?? DEFAULT_GENERATION_CONFIG.sequence_threshold;
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
        seqResult = await directorCheckSequence(
          buildSequencePages(pages, run.id),
          style
        );
        insertSequenceCheck(run.id, story.id, seqResult);
        if (seqResult.score >= seqThreshold) break;
      }
    }

    const status: RunStatus = failed > 0 ? "partial_failed" : "completed";
    finishRun(run.id, status);
    finishTask(taskId, "completed", failed > 0 ? `${failed} 页生成失败` : null);
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
    const msg = err?.message ?? String(err);
    finishRun(run.id, "failed");
    finishTask(taskId, "failed", msg);
    try {
      setStatus(story.id, STORY_STATUS.GEN_PARTIAL_FAILED);
    } catch {
      /* ignore */
    }
  }
}

/** 单页补画：只往「当前版本」追加候选图，不新建 run、不翻默认图、不改故事状态。 */
export async function runSinglePage(taskId: number): Promise<void> {
  const task = getTask(taskId);
  if (!task || !task.run_id || !task.page_id) {
    finishTask(taskId, "failed", "invalid task");
    return;
  }
  const run = getRun(task.run_id);
  if (!run) {
    finishTask(taskId, "failed", "run not found");
    return;
  }
  const pageId = task.page_id;
  const page = db
    .prepare(`SELECT * FROM pages WHERE id = ?`)
    .get(pageId) as Page | undefined;
  if (!page) {
    finishTask(taskId, "failed", "page not found");
    return;
  }
  const story = getStoryRaw(run.story_id);
  if (!story) {
    finishTask(taskId, "failed", "story not found");
    return;
  }
  setTaskStatus(taskId, "running");

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
      taskId,
      style,
      extracted,
      sheetMap,
      aspectRatio: run.aspect_ratio || DEFAULT_GENERATION_CONFIG.aspect_ratio,
      frameThreshold: run.frame_threshold ?? DEFAULT_GENERATION_CONFIG.frame_threshold,
      // 补画属「重试」语义，预算用 max_frame_retry（首跑才用 initial_retry_budget）
      frameBudget: run.max_frame_retry ?? DEFAULT_GENERATION_CONFIG.max_frame_retry,
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
    // 单页补画不改变 run 与故事状态：只是给当前版本追加候选
    finishTask(
      taskId,
      r.bestRowId != null ? "completed" : "failed",
      r.bestRowId != null ? null : "本页未能生成可用候选图"
    );
  } catch (err: any) {
    finishTask(taskId, "failed", err?.message ?? String(err));
  }
}
