// 一次性数据修复：把因 TTS 调用挂起而永久停在 generating 的配音方案，
// 翻回 interrupted（可被「继续生成」复用），并把其卡住的 tts 任务标记为 failed，
// 使前端不再一直显示「配音中」。幂等、可重复执行。
//
// 用法：npx tsx scripts/fixAudioSets.ts [storyId]
//   storyId 省略则修复全部故事。

import { initDb, db } from "../src/db/sqlite";

async function main() {
  await initDb();
  const onlyStory = process.argv[2] ? Number(process.argv[2]) : null;

  const where = onlyStory ? `WHERE story_id=${onlyStory} AND status='generating'` : `WHERE status='generating'`;
  const stuck = db
    .prepare(`SELECT id, story_id, name, status FROM audio_sets ${where}`)
    .all() as Array<{ id: number; story_id: number; name: string; status: string }>;

  console.log(`发现 generating 状态的配音方案：${stuck.length} 条`);
  for (const s of stuck) {
    db.prepare(
      `UPDATE audio_sets SET status='interrupted', updated_at=? WHERE id=?`
    ).run(new Date().toISOString(), s.id);
    db.prepare(
      `UPDATE generation_tasks SET status='failed', finished_at=?, last_error=?
       WHERE kind='tts' AND story_id=? AND status IN ('queued','running')`
    ).run(new Date().toISOString(), "由 fixAudioSets 脚本强制中断（原 TTS 调用疑似挂起）", s.story_id);
    console.log(`  -> 方案 #${s.id}（故事 ${s.story_id} "${s.name}"）已翻为 interrupted`);
  }
  console.log("修复完成。重启后端后该方案即可「继续生成」。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
