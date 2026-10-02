// TTS 配音服务：基于 Edge TTS 为「每个配音方案 × 每页分段 × 每种语言」合成音频。
// 设计要点：
//  - 文本严格来自已落库的 page_segments（绝不重新调 LLM），保证 文本-语音 同源于一行。
//  - 每段音频按 (audio_set_id, page_id, segment_id, lang, scene) 唯一绑定，多组方案互不覆盖。
//  - 合成前先查 page_audio 是否已有该段 → 已有则跳过，天然支持「宕机续传」。
//  - 单段失败仅记录并跳过，不中断整书生成。
//  - TTS_MOCK=1 时不联网，写出静音 MP3 占位，便于离线联调/测试。

import fs from "node:fs";
import path from "node:path";
import { EdgeTTS } from "edge-tts-universal";
import { db, DATA_DIR, isCancelRequested, markTaskCancelled } from "../db/sqlite";
import { getPagesByStory, getStoryRaw } from "./storyService";
import type { SegmentRole } from "../types";

const now = () => new Date().toISOString();

// 单次 TTS 合成的硬超时：避免离线/网络异常时 synthesize() 永久挂起，
// 导致 audio_sets 永远停在 generating、任务永不结束（前端一直显示"配音中"）。
const TTS_SYNTH_TIMEOUT_MS = Number(process.env.TTS_SYNTH_TIMEOUT_MS) || 40000;
// 单段失败后的重试次数（含首次共 N+1 次），缓解微软限流 / 网络抖动导致的 NoAudioReceived。
const TTS_RETRY = Number(process.env.TTS_RETRY ?? 3);
// 退避基数：第 k 次重试前等待 base * 2^k ms（指数退避）。
const TTS_RETRY_BASE_MS = Number(process.env.TTS_RETRY_BASE_MS ?? 800);
// 段与段之间的限速间隔：连续发请求易被微软限流返回空流，留一点间隔降低概率。
const TTS_INTERVAL_MS = Number(process.env.TTS_INTERVAL_MS ?? 300);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type Lang = "zh" | "en";

/** 配音方案配置：可选各角色/语言音色覆盖 + 合成的语种。 */
export interface AudioSetConfig {
  voices?: Partial<Record<SegmentRole, Partial<Record<Lang, string>>>>;
  // 按角色名指定音色（如 {"小兔子": {"zh": "zh-CN-YunxiNeural"}}），优先级高于按 role 的 voices。
  voicesBySpeaker?: Partial<Record<string, Partial<Record<Lang, string>>>>;
  langs?: Lang[];
}

const DEFAULT_VOICE: Record<Lang, Record<SegmentRole, string>> = {
  zh: {
    narration: "zh-CN-XiaoxiaoNeural",
    dialogue: "zh-CN-YunxiNeural",
    background: "zh-CN-XiaoxiaoNeural",
    sfx: "zh-CN-XiaoxiaoNeural",
  },
  en: {
    narration: "en-US-AriaNeural",
    dialogue: "en-US-GuyNeural",
    background: "en-US-AriaNeural",
    sfx: "en-US-AriaNeural",
  },
};

function pickVoice(
  role: SegmentRole,
  lang: Lang,
  config?: AudioSetConfig | null,
  speaker?: string | null
): string {
  // 1) 角色名精确音色（最高优先）：不同角色可用不同声音讲对白。
  const sv = speaker ? config?.voicesBySpeaker?.[speaker]?.[lang] : undefined;
  if (sv) return sv;
  // 2) 按角色类型覆盖（narration/dialogue/...）。
  const v = config?.voices?.[role]?.[lang];
  if (v) return v;
  // 3) 默认音色。
  return DEFAULT_VOICE[lang][role];
}

/** 生成一段静音 MP3（仅 TTS_MOCK 用）：拼若干 MPEG1 Layer3 静音帧，浏览器可播放。 */
function writeSilentMp3(absPath: string, frames = 12): void {
  const header = Buffer.from([0xff, 0xfb, 0x90, 0x00]); // MPEG1 L3, 128kbps, 44.1kHz
  const frameSize = 144 * 128000 / 44100; // ≈ 417 字节
  const out = Buffer.alloc(header.length + Math.floor(frameSize) - header.length);
  header.copy(out, 0);
  const buf = Buffer.concat(Array.from({ length: frames }, () => out));
  fs.writeFileSync(absPath, buf);
}

interface WorkItem {
  pageId: number;
  pageNumber: number;
  segmentId: number | null;
  role: SegmentRole;
  speaker: string | null;
  textZh: string;
  textEn: string;
}

export interface RunTtsOptions {
  langs?: Lang[];
  regenerate?: boolean;
  taskId?: number;
  onProgress?: (done: number, total: number, failed: number) => void;
}

export interface RunTtsResult {
  ok: number;
  failed: number;
  total: number;
}

function buildWorkItems(storyId: number): WorkItem[] {
  const pages = getPagesByStory(storyId);
  const items: WorkItem[] = [];
  for (const page of pages) {
    const segs = db
      .prepare(
        `SELECT id, page_id, seq, role, speaker, text_zh, text_en
         FROM page_segments WHERE page_id = ? ORDER BY seq ASC`
      )
      .all(page.id) as Array<{
      id: number;
      page_id: number;
      seq: number;
      role: string;
      speaker: string | null;
      text_zh: string;
      text_en: string;
    }>;
    if (segs.length === 0) {
      // 轻量兜底：该页无分段（极少见），用整页文本作为单条 narration 合成。
      items.push({
        pageId: page.id,
        pageNumber: page.page_number,
        segmentId: null,
        role: "narration",
        speaker: null,
        textZh: page.text_zh || "",
        textEn: page.text_en || "",
      });
    } else {
      for (const s of segs) {
        const role = (["narration", "dialogue", "background", "sfx"].includes(s.role)
          ? s.role
          : "narration") as SegmentRole;
        // background/sfx 是环境/音效描述，不是角色台词，不应被 TTS 朗读，跳过。
        if (role === "background" || role === "sfx") continue;
        items.push({
          pageId: s.page_id,
          pageNumber: page.page_number,
          segmentId: s.id,
          role,
          speaker: s.speaker ?? null,
          textZh: s.text_zh || "",
          textEn: s.text_en || "",
        });
      }
    }
  }
  return items;
}

function audioExists(
  audioSetId: number,
  pageId: number,
  segmentId: number | null,
  lang: Lang,
  scene: string
): boolean {
  const row = segmentId == null
    ? db
        .prepare(
          `SELECT 1 FROM page_audio
           WHERE audio_set_id=? AND page_id=? AND segment_id IS NULL AND lang=? AND scene=?`
        )
        .get(audioSetId, pageId, lang, scene)
    : db
        .prepare(
          `SELECT 1 FROM page_audio
           WHERE audio_set_id=? AND page_id=? AND segment_id=? AND lang=? AND scene=?`
        )
        .get(audioSetId, pageId, segmentId, lang, scene);
  return !!row;
}

async function synthOnce(
  text: string,
  voice: string
): Promise<{ buffer: Buffer; durationMs: number }> {
  const tts = new EdgeTTS(text, voice, {
    rate: "+0%",
    volume: "+0%",
    pitch: "+0Hz",
  });
  const result = await withTimeout(
    tts.synthesize(),
    TTS_SYNTH_TIMEOUT_MS,
    `TTS 合成超时（>${TTS_SYNTH_TIMEOUT_MS}ms）`
  );
  const buffer = Buffer.from(await result.audio.arrayBuffer());
  const last = result.subtitle?.[result.subtitle.length - 1];
  const durationMs = last
    ? Math.round(((last.offset + last.duration) / 1e7) * 1000)
    : 0;
  return { buffer, durationMs };
}

async function synthToBuffer(
  text: string,
  voice: string
): Promise<{ buffer: Buffer; durationMs: number } | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= TTS_RETRY; attempt++) {
    try {
      return await synthOnce(text, voice);
    } catch (err) {
      lastErr = err;
      console.error(
        `TTS synthesize failed (attempt ${attempt + 1}/${TTS_RETRY + 1}):`,
        err
      );
      // 还有重试次数 → 指数退避后重试；已用尽 → 跳出返回失败。
      if (attempt < TTS_RETRY) {
        await sleep(TTS_RETRY_BASE_MS * Math.pow(2, attempt));
      }
    }
  }
  console.error("TTS synthesize 最终失败:", lastErr);
  return null;
}

export async function runTtsForStory(
  storyId: number,
  audioSetId: number,
  opts: RunTtsOptions = {}
): Promise<RunTtsResult> {
  const story = getStoryRaw(storyId);
  if (!story) throw new Error(`故事不存在: ${storyId}`);
  const setRow = getAudioSet(audioSetId);
  if (!setRow) throw new Error(`配音方案不存在: ${audioSetId}`);

  const langs = opts.langs && opts.langs.length ? opts.langs : (["zh", "en"] as Lang[]);
  const config = parseConfig(setRow.config_json);

  db.prepare(`UPDATE audio_sets SET status='generating', updated_at=? WHERE id=?`).run(
    now(),
    audioSetId
  );

  const items = buildWorkItems(storyId);

  // 仅对「有文本」的 (item, lang) 组合生成任务，避免空文本卡住进度。
  const jobs: Array<{
    item: WorkItem;
    lang: Lang;
    text: string;
    voice: string;
    relPath: string;
    absPath: string;
    scene: string;
  }> = [];
  for (const item of items) {
    for (const lang of langs) {
      const text = lang === "zh" ? item.textZh : item.textEn;
      if (!text || !text.trim()) continue;
      const voice = pickVoice(item.role, lang, config, item.speaker);
      const segLabel = item.segmentId != null ? `seg_${item.segmentId}` : "seg_full";
      const fileName = `${segLabel}_${lang}.mp3`;
      // 相对路径以 "assets/" 开头（与 imageStore 约定一致），绝对路径以 DATA_DIR 为基，
      // 这样磁盘真实位置为 DATA_DIR/assets/{story}/{...}，刚好命中 /assets/* 静态路由。
      const relPath = path
        .join(
          "assets",
          String(storyId),
          "audio_sets",
          String(audioSetId),
          String(item.pageId),
          fileName
        )
        .split(path.sep)
        .join("/");
      const absPath = path.join(DATA_DIR, relPath);
      jobs.push({
        item,
        lang,
        text,
        voice,
        relPath,
        absPath,
        scene: item.role,
      });
    }
  }

  const total = jobs.length;
  let done = 0;
  let failed = 0;

  for (const job of jobs) {
    // 取消检查（S16，页级）：被请求取消则停在当前 job 之前，已合成的音频保留。
    if (opts.taskId != null && isCancelRequested(opts.taskId)) {
      markTaskCancelled(opts.taskId);
      return { ok: done, failed, total };
    }
    // 续传：已存在且非强制重生成 → 跳过（done 仍计入，使进度从断点递增）。
    const exists = audioExists(
      audioSetId,
      job.item.pageId,
      job.item.segmentId,
      job.lang,
      job.scene
    );
    if (exists && !opts.regenerate) {
      done += 1;
      opts.onProgress?.(done, total, failed);
      continue;
    }

    let synth: { buffer: Buffer; durationMs: number } | null = null;
    if (process.env.TTS_MOCK) {
      synth = { buffer: Buffer.alloc(0), durationMs: 800 };
    } else {
      // 段间限速：连续请求易被微软限流返回空流，合成前留一点间隔降低概率。
      if (TTS_INTERVAL_MS > 0) await sleep(TTS_INTERVAL_MS);
      synth = await synthToBuffer(job.text, job.voice);
    }
    if (!synth) {
      failed += 1;
      opts.onProgress?.(done, total, failed);
      continue;
    }

    fs.mkdirSync(path.dirname(job.absPath), { recursive: true });
    if (process.env.TTS_MOCK) {
      writeSilentMp3(job.absPath);
    } else {
      fs.writeFileSync(job.absPath, synth.buffer);
    }

    db.prepare(
      `INSERT INTO page_audio
        (audio_set_id, page_id, story_id, segment_id, lang, scene, audio_path, voice, provider, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(audio_set_id, page_id, segment_id, lang, scene)
       DO UPDATE SET audio_path=excluded.audio_path, voice=excluded.voice,
                     duration_ms=excluded.duration_ms, created_at=excluded.created_at`
    ).run(
      audioSetId,
      job.item.pageId,
      storyId,
      job.item.segmentId,
      job.lang,
      job.scene,
      job.relPath,
      job.voice,
      "edge-tts-universal",
      synth.durationMs,
      now()
    );

    done += 1;
    opts.onProgress?.(done, total, failed);
  }

  // 收尾状态：全失败 → failed；部分失败 → interrupted（可续传）；全成功 → completed。
  const finalStatus = failed === total && total > 0 ? "failed" : failed > 0 ? "interrupted" : "completed";
  db.prepare(`UPDATE audio_sets SET status=?, updated_at=? WHERE id=?`).run(
    finalStatus,
    now(),
    audioSetId
  );
  // 层快照：任一 audio_set 曾 completed → 故事标记「已配音」（不区分次数，至少一次）。
  if (finalStatus === "completed") {
    db.prepare(`UPDATE stories SET has_audio = 1, updated_at = ? WHERE id = ?`).run(
      now(),
      storyId
    );
  }

  return { ok: done - 0, failed, total };
}

// ===================== 配音方案（语音组）CRUD =====================

export function parseConfig(json?: string | null): AudioSetConfig | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as AudioSetConfig;
  } catch {
    return null;
  }
}

export function createAudioSet(
  storyId: number,
  name: string,
  config?: AudioSetConfig | null,
  status: "pending" | "generating" = "generating"
): number {
  const info = db
    .prepare(
      `INSERT INTO audio_sets (story_id, name, status, config_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(storyId, name, status, config ? JSON.stringify(config) : null, now());
  return Number(info.lastInsertRowid);
}

export function getAudioSet(setId: number): {
  id: number;
  story_id: number;
  name: string;
  status: string;
  config_json: string | null;
  is_selected: number;
  created_at: string | null;
} | undefined {
  return db
    .prepare(`SELECT * FROM audio_sets WHERE id = ?`)
    .get(setId) as any;
}

export function listAudioSets(storyId: number): Array<{
  id: number;
  name: string;
  status: string;
  is_selected: number;
  config_json: string | null;
  created_at: string | null;
  total: number;
  done: number;
}> {
  const sets = db
    .prepare(`SELECT * FROM audio_sets WHERE story_id = ? ORDER BY id DESC`)
    .all(storyId) as any[];
  return sets.map((s: any) => {
    const done = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM page_audio WHERE audio_set_id = ?`)
        .get(s.id) as { c: number }
    ).c;
    const segCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM page_segments ps
           JOIN pages p ON p.id = ps.page_id WHERE p.story_id = ?`
        )
        .get(storyId) as { c: number }
    ).c;
    const pagesWithoutSeg = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM pages p
           WHERE p.story_id = ? AND NOT EXISTS (SELECT 1 FROM page_segments ps WHERE ps.page_id = p.id)`
        )
        .get(storyId) as { c: number }
    ).c;
    const langs = parseConfig(s.config_json)?.langs ?? ["zh", "en"];
    const total = (segCount + pagesWithoutSeg) * langs.length;
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      is_selected: s.is_selected,
      config_json: s.config_json,
      created_at: s.created_at,
      total,
      done,
    };
  });
}

export function hasGeneratingAudioSet(storyId: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM audio_sets WHERE story_id = ? AND status = 'generating' LIMIT 1`
    )
    .get(storyId);
  return !!row;
}

export function selectAudioSet(setId: number): boolean {
  const set = getAudioSet(setId);
  if (!set) return false;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE audio_sets SET is_selected = 0 WHERE story_id = ?`).run(
      set.story_id
    );
    db.prepare(`UPDATE audio_sets SET is_selected = 1 WHERE id = ?`).run(setId);
    db.prepare(
      `UPDATE stories SET selected_audio_set_id = ?, updated_at = ? WHERE id = ?`
    ).run(setId, now(), set.story_id);
  });
  tx();
  return true;
}

/**
 * 供阅读器使用：返回「当前/指定配音方案」的分段与对应音频 URL。
 * 每页分段按 seq 排列；音频按语言（zh/en）映射，无则 undefined。
 */
export function getBookAudio(
  storyId: number,
  audioSetId: number
): {
  audioSetId: number;
  pages: Array<{
    pageNumber: number;
    segments: Array<{
      seq: number;
      role: SegmentRole;
      speaker: string | null;
      speakerEn: string | null;
      textZh: string;
      textEn: string;
      audioUrls: { zh?: string; en?: string };
    }>;
  }>;
} {
  const pages = getPagesByStory(storyId);
  const whole = db
    .prepare(
      `SELECT page_id, lang, audio_path FROM page_audio
       WHERE audio_set_id = ? AND segment_id IS NULL AND story_id = ?`
    )
    .all(audioSetId, storyId) as Array<{ page_id: number; lang: string; audio_path: string }>;
  const wholeMap = new Map<string, string>();
  for (const w of whole) wholeMap.set(`${w.page_id}_${w.lang}`, w.audio_path);

  const out = [];
  for (const page of pages) {
    const segs = db
      .prepare(
        `SELECT id, seq, role, speaker, speaker_en, text_zh, text_en
         FROM page_segments WHERE page_id = ? ORDER BY seq ASC`
      )
      .all(page.id) as Array<{
      id: number;
      seq: number;
      role: string;
      speaker: string | null;
      speaker_en: string | null;
      text_zh: string;
      text_en: string;
    }>;

    const segmentRows = segs.length
      ? segs
      : [
          {
            id: -1,
            seq: 0,
            role: "narration",
            speaker: null,
            speaker_en: null,
            text_zh: page.text_zh || "",
            text_en: page.text_en || "",
          },
        ];

    const segments = segmentRows.map((s) => {
      const audioFor = (lang: Lang): string | undefined => {
        if (s.id === -1) return wholeMap.get(`${page.id}_${lang}`) ?? undefined;
        const row = db
          .prepare(
            `SELECT audio_path FROM page_audio
             WHERE audio_set_id = ? AND page_id = ? AND segment_id = ? AND lang = ? AND scene = ?`
          )
          .get(audioSetId, page.id, s.id, lang, s.role) as
          | { audio_path: string }
          | undefined;
        return row?.audio_path ?? undefined;
      };
      return {
        seq: s.seq,
        role: (["narration", "dialogue", "background", "sfx"].includes(s.role)
          ? s.role
          : "narration") as SegmentRole,
        speaker: s.speaker,
        speakerEn: s.speaker_en,
        textZh: s.text_zh,
        textEn: s.text_en,
        audioUrls: { zh: audioFor("zh"), en: audioFor("en") },
      };
    });

    out.push({ pageNumber: page.page_number, segments });
  }
  return { audioSetId, pages: out };
}

/** 取故事当前选用的配音方案 id（无显式选用时，兜底首个可用方案）。
 *  可用定义：completed（全成功）或 interrupted（部分成功，仍有音频可播）。
 *  仅 failed（零音频）/ generating（尚未产出）不参与兜底，避免选中空方案。 */
export function getSelectedAudioSetId(storyId: number): number | null {
  const story = getStoryRaw(storyId);
  if (story?.selected_audio_set_id) return story.selected_audio_set_id;
  const row = db
    .prepare(
      `SELECT id FROM audio_sets
       WHERE story_id = ? AND status IN ('completed', 'interrupted')
       ORDER BY (status = 'completed') DESC, id ASC LIMIT 1`
    )
    .get(storyId) as { id: number } | undefined;
  return row?.id ?? null;
}
