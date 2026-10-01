# 项目结构（BookAgent / 绘本 AI 生成平台）

根目录：`d:/workspace/git/huiBen`。BookAgent 是主体（绘本生成 + 管理 + 阅读）。

## 子项目划分（修改代码前先确认改哪个）
- `BookAgent/backend`：Node + sql.js(SQLite WASM)。入口 `src/index.ts`，API 前缀 `/api`。
  关键服务：`storyService`(改写/分段落库)、`geminiService`(LLM 生成 prompt)、
  `ttsService`(edge-tts-universal 配音)、`hotspotService`(热区与 `getHotspotEditorData`/`getBookAudio`)。
- `BookAgent/frontend`：管理端（绘本库 `StoryList`、故事详情 `StoryDetail`、热区设置 `HotspotSettings`）。
- `BookAgent/reader`：**独立的 Vite 阅读器项目**，即"bookreader 中的 reader"。
  访问路径 `VITE_READER_BASE/book/{storyId}`，消费 `/api/stories/{id}/book-audio`。
  ⚠️ 改端上阅读 UI（分段/图上热区渲染）必须改 `reader/`，不是 `frontend/`。
  `SpreadView` 复用 `PageView`，分段渲染逻辑只在 `PageView.tsx` 的 `SegmentList.renderRow`。

## 数据约定
- `page_segments` 有 `role`(narration/dialogue/background/sfx) 与 `speaker`。
- 对话台词 `textZh/textEn` **只含纯台词**，说话人必须放 `speaker`，不要在文本里写"X说："。
- `background/sfx` 是环境/音效，TTS 不朗读（已跳过）。
- 阅读器渲染规则：图上热区(`hotspot.segment_seq` 命中的 on-image 分段)显示纯台词、**不显示**"X说："前缀；图外文案列表显示"`speaker：`"前缀。

## TTS 备注
- `edge-tts-universal`；`NoAudioReceived` 多为网络不可达/被墙 或 微软限流。
- `TTS_MOCK=1` 离线写静音占位，便于无网开发。已有重试(`TTS_RETRY`)/指数退避/段间限速(`TTS_INTERVAL_MS`)。

## 开发约定
- 开发阶段数据可直接删库重建（`bookagent.db` 由 schema 重建），无需做历史数据清洗迁移。
