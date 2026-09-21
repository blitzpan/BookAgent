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

CREATE TABLE IF NOT EXISTS generation_runs (
  id                  INTEGER PRIMARY KEY,
  story_id            INTEGER NOT NULL,
  scope               TEXT NOT NULL DEFAULT 'full',  -- full(整书)/single_page(单页补画) (R9)
  target_page_id      INTEGER,                        -- scope=single_page 时指向目标页 (R9)
  status              TEXT NOT NULL DEFAULT 'queued',  -- queued/running/completed/partial_failed/failed/interrupted
  progress            TEXT,    -- JSON:{total,done,failed}
  last_error          TEXT,
  frame_threshold     REAL DEFAULT 0.75,
  max_frame_retry     INTEGER DEFAULT 3,   -- 单页手动重画(manual_new)预算;首跑由 initial_retry_budget 控制
  sequence_threshold  REAL DEFAULT 0.8,
  max_sequence_retry  INTEGER DEFAULT 1,
  initial_retry_budget INTEGER DEFAULT 1,  -- 首跑每页生成尝试次数上限(按需哲学核心)
  text_provider       TEXT,
  image_provider      TEXT,
  vision_provider     TEXT,
  aspect_ratio        TEXT,
  image_size          TEXT,
  started_at          TEXT,
  finished_at         TEXT,
  created_at          TEXT,
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

CREATE TABLE IF NOT EXISTS page_images (
  id                  INTEGER PRIMARY KEY,
  page_id             INTEGER NOT NULL,
  story_id            INTEGER NOT NULL,
  generation_run_id   INTEGER NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_characters_story ON characters(story_id, generation_run_id);
CREATE INDEX IF NOT EXISTS idx_pages_story ON pages(story_id);
CREATE INDEX IF NOT EXISTS idx_page_images_run ON page_images(generation_run_id, page_id);
CREATE INDEX IF NOT EXISTS idx_runs_story ON generation_runs(story_id);
