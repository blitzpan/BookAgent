// 离线冒烟测试：mock 文本后端 + TTS_MOCK 静音占位，验证「分段落库 → 多组配音 → 续传 → 选用 → 阅读器音频映射」。
// 使用临时 DB 与 assets，不污染开发数据。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.MOCK_AI = "1";
process.env.TTS_MOCK = "1";
const dbFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "tts_smoke.sqlite");
process.env.DB_PATH = dbFile;
process.env.BOOKAGENT_ASSETS_DIR = path.join(path.dirname(dbFile), "tts_smoke_assets");
try {
  fs.rmSync(dbFile, { force: true });
  console.log("removed stale db:", dbFile);
} catch (e) {
  console.log("rm db failed:", (e as Error).message);
}

const { initDb } = await import("../src/db/sqlite");
const { db } = await import("../src/db/sqlite");
const { createStory, rewriteStory, getStoryRaw, getPagesByStory } = await import(
  "../src/services/storyService"
);
const {
  createAudioSet,
  runTtsForStory,
  listAudioSets,
  selectAudioSet,
  getBookAudio,
  getSelectedAudioSetId,
  hasGeneratingAudioSet,
} = await import("../src/services/ttsService");

await initDb();

console.log("DB_PATH:", process.env.DB_PATH);
const cols = db.prepare("PRAGMA table_info(audio_sets)").all() as Array<{ name: string }>;
console.log("audio_sets columns:", cols.map((c) => c.name).join(","));

process.on("unhandledRejection", (e) => console.error("UNHANDLED_REJECTION", e));

// 细粒度诊断：单独跑分页，确认 mock 产出分段
try {
  const { parseStoryIntoPages } = await import("../src/services/geminiService");
  const parsed = await parseStoryIntoPages("森林里住着一只小兔子。它遇到了迷路的小松鼠。", null, 2);
  console.log(
    "parseStoryIntoPages ok, pages:",
    parsed.length,
    "page0 segments:",
    parsed[0]?.segments?.length,
    "page0 textZh:",
    parsed[0]?.textZh?.slice(0, 12)
  );
} catch (e: any) {
  console.error("PARSE ERROR:", e?.name, e?.message, e?.stack);
  process.exit(1);
}

const created = createStory({
  original_text:
    "从前有一只小兔子，它住在森林里。一天，它遇到了一只迷路的小松鼠。小兔子说：“别怕，我带你回家。” 它们成了好朋友。从此，森林里多了一份温暖。",
  user_title: "小兔子和小松鼠",
  target_page_count: 4,
});
const storyId = created.id;
console.log("created story", storyId);

let rw;
try {
  rw = await rewriteStory(storyId);
} catch (err: any) {
  console.error("REWRITE RAW:", err, "typeof:", typeof err, "ctor:", (err as any)?.constructor?.name);
  process.exit(1);
}
console.log("rewrite status", rw?.status, "mode", rw?.mode);

const pages = getPagesByStory(storyId);
const segCount = (
  db.prepare(`SELECT COUNT(*) c FROM page_segments WHERE story_id=?`).get(storyId) as {
    c: number;
  }
).c;
console.log("pages", pages.length, "segments", segCount);
if (pages.length === 0 || segCount === 0) {
  console.error("FAIL: 分段未落库");
  process.exit(1);
}

// 第一组配音
const setId1 = createAudioSet(storyId, "方案A");
const r1 = await runTtsForStory(storyId, setId1, {
  onProgress: (d, t, f) => console.log(`  [方案A] progress ${d}/${t} failed=${f}`),
});
console.log("方案A result", r1);

// 模拟「宕机续传」：把状态打回 generating 再跑一次，应跳过已有（done 不变、total 一致）
db.prepare(`UPDATE audio_sets SET status='generating' WHERE id=?`).run(setId1);
const r1b = await runTtsForStory(storyId, setId1, {});
console.log("方案A 续传 result", r1b);

// 第二组配音（多组对比）
const setId2 = createAudioSet(storyId, "方案B");
const r2 = await runTtsForStory(storyId, setId2, {});
console.log("方案B result", r2);

const sets = listAudioSets(storyId);
console.log(
  "audioSets",
  sets.map((s) => ({ id: s.id, name: s.name, status: s.status, done: s.done, total: s.total }))
);

console.log("hasGenerating", hasGeneratingAudioSet(storyId));

selectAudioSet(setId2);
console.log("selected after select", getSelectedAudioSetId(storyId), "(期望", setId2, ")");

const book = getBookAudio(storyId, setId2);
const totalAudio = book.pages.reduce(
  (acc, p) => acc + p.segments.filter((s) => s.audioUrls.zh || s.audioUrls.en).length,
  0
);
console.log("book pages", book.pages.length, "有音频的分段数", totalAudio);

console.log("SMOKE_OK");
process.exit(0);
