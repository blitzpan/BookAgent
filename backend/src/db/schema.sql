-- BookAgent 后端 SQLite 建表
-- 依据 design/数据库设计.md，并含已确认的修订：
--   R2: stories.status 含「生图部分失败」，统一「审批通过的作品」
--   R8: stories 新增 target_page_count（改写/分页依赖，必须落库）
--   R9: generation_runs 新增 scope / target_page_id（整书 vs 单页 run）
PRAGMA foreign_keys = ON;

-- 注意：sql.js（WASM SQLite）不支持 journal_mode=WAL，故此处不设置。

CREATE TABLE IF NOT EXISTS stories (
  id                  INTEGER PRIMARY KEY,
  user_title          TEXT,                       -- 用户自行输入的标题(可选,空则列表用预览占位)
  ai_title_zh         TEXT,                       -- MVP不实现生成,留空
  ai_title_en         TEXT,                       -- MVP不实现生成,留空
  original_text       TEXT    NOT NULL,
  refined_text        TEXT,                       -- AI改写后的全文
  style               TEXT,                       -- 全局画风/语气,注入改写/分页/锚图/每页prompt
  target_page_count   INTEGER,                    -- 目标页数(建故事时指定,改写/分页依据;重启后仍可恢复,故落库) (R8)
  status              TEXT    NOT NULL DEFAULT '新建',  -- 见 constants/status.ts STORY_STATUS
  safety_result       TEXT,                       -- JSON:{passed,isSafe,reason}
  rewrite_result      TEXT,                       -- JSON:{mode,feedback}
  inspiration_image_path TEXT,                    -- 灵感图(磁盘相对路径),仅影响分页
  generation_config   TEXT,                       -- JSON 生图参数(见 constants/generationConfig.ts)
  current_run_id      INTEGER,                    -- 当前生效的整书 run(版本指针)
  selected_audio_set_id INTEGER,                   -- 当前选用的配音方案(audio_sets.id)，开发阶段新增
  created_at          TEXT,
  updated_at          TEXT,
  deleted_at          TEXT
);

CREATE TABLE IF NOT EXISTS characters (
  id                  INTEGER PRIMARY KEY,
  story_id            INTEGER NOT NULL,
  generation_run_id   INTEGER NOT NULL,           -- 锚图挂 run(锚图 run 概念)
  char_key            TEXT,
  name                TEXT,
  visual_description  TEXT,
  sheet_image_path    TEXT,                       -- assets/{story_id}/anchors/{id}.png
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

CREATE TABLE IF NOT EXISTS pages (
  id            INTEGER PRIMARY KEY,
  story_id      INTEGER NOT NULL,
  page_number   INTEGER NOT NULL,
  text_zh       TEXT,                             -- MVP 不实现双语,留空
  text_en       TEXT,
  image_prompt  TEXT,
  lock_text     TEXT,
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

-- 一次「整书生成」的版本记录：产物归属 + 版本参数快照 + 产出状态。
-- 进度/错误/重试/恢复属于「执行」，归 generation_tasks。
CREATE TABLE IF NOT EXISTS generation_runs (
  id                  INTEGER PRIMARY KEY,
  story_id            INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'running',  -- running/completed/partial_failed/failed
  frame_threshold     REAL DEFAULT 0.75,
  max_frame_retry     INTEGER DEFAULT 3,   -- 单页手动重画(manual_new)预算;首跑由 initial_retry_budget 控制
  sequence_threshold  REAL DEFAULT 0.8,
  max_sequence_retry  INTEGER DEFAULT 1,
  initial_retry_budget INTEGER DEFAULT 1,  -- 首跑每页生成尝试次数上限(按需哲学核心)
  text_provider       TEXT,                       -- 实际生效的 provider(不再是请求传入值)
  image_provider      TEXT,
  vision_provider     TEXT,
  aspect_ratio        TEXT,
  image_size          TEXT,
  started_at          TEXT,
  finished_at         TEXT,
  created_at          TEXT,
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

-- 每次「异步执行」的记录：整书生成 / 单页补画 / 将来的批量重画。
-- 与 run 的关系：整书任务创建并归属于某个 run；补画任务挂在已有 run 上（不新建 run）。
CREATE TABLE IF NOT EXISTS generation_tasks (
  id                  INTEGER PRIMARY KEY,
  story_id            INTEGER NOT NULL,
  run_id              INTEGER,                        -- 归属版本；整书任务创建时即有
  page_id             INTEGER,                        -- kind=single_page 时的目标页
  kind                TEXT NOT NULL,                  -- full / single_page
  status              TEXT NOT NULL DEFAULT 'queued', -- queued/running/completed/failed
  progress            TEXT,                           -- JSON:{total,done,failed}
  params_json         TEXT,                           -- 本次执行参数快照(可覆盖版本参数)
  last_error          TEXT,
  created_at          TEXT,
  started_at          TEXT,
  finished_at         TEXT,
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

CREATE TABLE IF NOT EXISTS page_images (
  id                  INTEGER PRIMARY KEY,
  page_id             INTEGER NOT NULL,
  story_id            INTEGER NOT NULL,
  generation_run_id   INTEGER NOT NULL,
  task_id             INTEGER,                        -- 产出该图的执行任务
  is_default          INTEGER DEFAULT 0,
  kind                TEXT,    -- initial/retry/manual_new/redraw
  prompt_used         TEXT,
  reference_sheet_ids TEXT,    -- JSON:本页用的角色记录 id 列表
  image_path          TEXT,    -- assets/{story_id}/{page_id}/{id}.png
  identity_score      REAL,
  identity_issues     TEXT,
  frame_score         REAL,
  frame_issues        TEXT,
  combined_score      REAL,
  safety_passed       INTEGER,
  reference_image_id  INTEGER,  -- redraw 用,本期占位
  attempt_index       INTEGER,
  created_at          TEXT,
  FOREIGN KEY (page_id) REFERENCES pages(id),
  FOREIGN KEY (story_id) REFERENCES stories(id),
  FOREIGN KEY (generation_run_id) REFERENCES generation_runs(id)
);

CREATE TABLE IF NOT EXISTS sequence_checks (
  id                INTEGER PRIMARY KEY,
  story_id          INTEGER NOT NULL,
  generation_run_id INTEGER NOT NULL,
  is_consistent     INTEGER,
  score             REAL,
  issues            TEXT,
  problem_pages     TEXT,
  FOREIGN KEY (story_id) REFERENCES stories(id),
  FOREIGN KEY (generation_run_id) REFERENCES generation_runs(id)
);

-- 开发阶段直接重建：旧版 page_audio（无 audio_set_id）先丢弃再建新表。
DROP TABLE IF EXISTS page_audio;

-- 页面内结构化文本行：支持角色/场景区分（旁白/对话/背景/音效）
CREATE TABLE IF NOT EXISTS page_segments (
  id        INTEGER PRIMARY KEY,
  page_id   INTEGER NOT NULL,
  story_id  INTEGER NOT NULL,
  seq       INTEGER NOT NULL,
  role      TEXT NOT NULL DEFAULT 'narration', -- 'narration'|'dialogue'|'background'|'sfx'
  speaker   TEXT,                              -- 对话角色名（role=dialogue）
  text_zh   TEXT NOT NULL,
  text_en   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seg_page ON page_segments(page_id, seq);

-- 配音方案（语音组）：一个故事可有多组，不同人物/音色；后台试听后选一组作为正式版
CREATE TABLE IF NOT EXISTS audio_sets (
  id          INTEGER PRIMARY KEY,
  story_id    INTEGER NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|generating|completed|interrupted|failed
  config_json TEXT,                            -- JSON: 各 role/lang 的 voice 配置
  is_selected INTEGER DEFAULT 0,               -- 每 story 仅一个为 1
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_audio_sets_story ON audio_sets(story_id, status);

-- 配音：每「方案 × 分段 × 语言 × 场景」一条，由已落库文本生成并回写绑定
CREATE TABLE IF NOT EXISTS page_audio (
  id          INTEGER PRIMARY KEY,
  audio_set_id INTEGER NOT NULL,
  page_id     INTEGER NOT NULL,
  story_id    INTEGER NOT NULL,
  segment_id  INTEGER,                         -- NULL=整页合并音频；否则对应 page_segments.id
  lang        TEXT NOT NULL,                   -- 'zh' | 'en'
  scene       TEXT NOT NULL DEFAULT 'narration',
  audio_path  TEXT NOT NULL,
  voice       TEXT,
  provider    TEXT,
  duration_ms INTEGER,
  created_at  TEXT,
  UNIQUE(audio_set_id, page_id, segment_id, lang, scene)
);
CREATE INDEX IF NOT EXISTS idx_audio_page ON page_audio(audio_set_id, page_id, lang);

CREATE INDEX IF NOT EXISTS idx_characters_story ON characters(story_id, generation_run_id);
CREATE INDEX IF NOT EXISTS idx_pages_story ON pages(story_id);
CREATE INDEX IF NOT EXISTS idx_page_images_run ON page_images(generation_run_id, page_id);
CREATE INDEX IF NOT EXISTS idx_runs_story ON generation_runs(story_id);
CREATE INDEX IF NOT EXISTS idx_tasks_story ON generation_tasks(story_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON generation_tasks(status);
