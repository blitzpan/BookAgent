# 任务：实现 BookAgent 绘本「展示 / 阅读系统」(reader)

你是一名资深前端工程师。请在当前仓库（BookAgent，绘本生成系统）中**新建一个独立的只读展示前端** `reader/`，用于向读者（儿童 / 家长）展示已发布的成品绘本。本任务只做「展示」，不做任何创作 / 管理功能。

> ✅ 状态：`reader/` 已按本文档实现完成，后端两处配套改动（CORS、`?status=` 已发布过滤）也已落地；**音频播放（分段播放列表 + 自动翻页 + 中/英/双语切音轨）已实现**，仅「图片热区」仍为渲染壳（无后端落库数据，待建）。
> 后端**可在本地直接运行**：`cd backend && npm run dev`（配合 `MOCK_AI=1` 可零成本跑通全链路），因此可以用 `curl` / 浏览器实测接口。
> 字段结构仍**以源码为准**（设计文档 `design/接口设计.md` 的响应示例已过时，不可照抄）。
> 优先阅读这些文件确认契约：`backend/src/routes/stories.ts`、`backend/src/routes/runs.ts`、`backend/src/routes/pageImages.ts`、`backend/src/services/storyService.ts`（listStories / getStoryDetail）、`backend/src/services/generationService.ts`（getRunDetail / listRunsForStory）、`backend/src/types.ts`、`backend/src/constants/status.ts`。

## 0. 项目背景（已有资产，勿重造）

- 仓库：monorepo，根目录 `backend/`（Fastify + SQLite + 生成 worker，已提供 REST API）、`frontend/`（已有的**管理壳**，含故事列表 / 审批 / 补画 / 生图配置，与本任务无关，不要改动它的业务逻辑）。
- 设计文档在 `design/`：`接口设计.md`、`数据库设计.md`、`架构设计.md`、`代码结构.md`——可作背景，但**接口字段一律以源码为准**。
- 后端核心类型见 `backend/src/types.ts`，资源路径约定见 `design/数据库设计.md` §4：
  - 页图 `assets/{story_id}/{page_id}/{image_id}.png`
  - 锚图 `assets/{story_id}/anchors/{character_id}.png`
- 状态枚举见 `backend/src/constants/status.ts`（如 `STORY_STATUS.PUBLISHED` 对应中文 `'审批通过的作品'`）。「已发布」即 `status === '审批通过的作品'`。

## 1. 锁定需求（必须严格遵守）

- 新建独立应用 **`reader/`**（Vite + React + TypeScript），与 `frontend/` 完全分离、可单独部署；纯只读、公开、面向读者。
- 目标设备优先级：**手机移动端 > 平板 (Pad) > PC**（PC 次要）。
- 视觉风格：**沉浸式满版**——图片满屏铺底，文字浮于图片底部（半透明底衬），最接近绘本 App 观感。
- 路由只有两个：
  - `/` 书架：已发布绘本网格，每本书封面取「第 1 页默认图」。
  - `/book/:storyId` 阅读器：核心页面。**不要**做「创作对话 / 诞生记」页，**不要**做角色锚图画廊（保持阅读器纯净只讲故事）。
- 阅读器版式（按屏宽断点 768px）：
  - 屏宽 < 768px（手机）：整屏**单页** + 左右滑动翻页；图占上方约 70%，双语旁白浮于底部。
  - 屏宽 ≥ 768px（Pad / PC）：**双页跨页铺开**（左图右文 / 左右两页），并提供「单页 / 跨页」手动切换按钮。
- 双语：提供「中 / 英 / 双语」一键切换；字号可调（儿童可读性，至少 3 档）。
- 数据范围：**仅展示已发布作品**（`stories.status === '审批通过的作品'`），绝不可暴露草稿 / 未审内容。

## 2. 复用后端接口（只读；字段以源码为准，禁止照搬 design 示例）

实现前先读 §0 列出的源码文件，确认每个响应的真实结构。下面给出**已从源码核对过**的结构（仍建议你再核对一遍，因为代码可能已变）：

### 2.1 `GET /api/stories`
- 路由：`stories.ts` 支持 `?status=` 过滤（`listStories(status)`）；无参时返回全部未删除（兼容管理壳）。reader 书架固定请求 `?status=审批通过的作品`。
- 真实结构：
```
{ "stories": [
    { "id": number, "user_title": string|null, "status": string, "page_count": number, "created_at": string|null }
] }
```
- 注意：`user_title` 可能为 `null`（书架需兜底文案，如「未命名绘本」）；**该列表不含封面图、不含 run**。

### 2.2 `GET /api/stories/:id`
- 路由：返回 `getStoryDetail(id)`：`{ story, pages }`，无则 404 `{ error }`。
- 真实结构：
```
{
  "story": { "id":number, "user_title":string|null, "original_text":string, "refined_text":string|null,
             "style":string|null, "target_page_count":number|null, "status":string, "created_at":string|null,
             "current_run_id":number|null, "generation_config":object, ... },
  "pages": [ { "id":number, "story_id":number, "page_number":number,
               "text_zh":string|null, "text_en":string|null, "image_prompt":string|null, "lock_text":string|null } ]
}
```
- 注意：
  - 字段是 **snake_case**（DB 原行）。
  - `text_zh` 在 MVP 多为 `null`（仅 `text_en` 被填充），前端必须降级（如中英缺一则只显示有值的一方，或双语模式退化为单语）。
  - **此接口不含图片、不含 run**——要渲染每页图，必须再取 run（见 2.3 / 2.4）。

### 2.3 `GET /api/stories/:id/runs`
- 真实结构：`{ "runs": GenerationRun[] }`，按 `id DESC`（最新在前）。
- `GenerationRun` 是 DB 原行（snake_case：`id, story_id, status, frame_threshold, max_frame_retry, sequence_threshold, max_sequence_retry, initial_retry_budget, text_provider, image_provider, vision_provider, aspect_ratio, image_size, started_at, finished_at, created_at`）。
- ⚠️ run **已无 `scope` / `progress` / `last_error`**：进度与重试属于「执行」，归 `generation_tasks`（见 `GET /api/tasks/:taskId` 的 `task.progress`，那才是 JSON 字符串，需 `JSON.parse`）。

### 2.4 `GET /api/runs/:runId`
- 路由：返回 `getRunDetail(runId)`，无则 404 `{ error }`。
- 真实结构（**这与 design 文档示例完全不同，以这里为准**）：
```
{
  "run": GenerationRun,                 // 同 2.3（无 scope / progress）
  "characters": [                       // 角色锚图（本项目阅读器不用，但结构在此）
    { "id":number, "char_key":string, "name":string, "visual_description":string, "sheet_image_path":string }
  ],
  "pages": [                            // 注意：这里是 pages 数组，每项含 page + 图片
    {
      "page": { "id":number, "page_number":number, "text_zh":string|null, "text_en":string|null, ... },
      "default_image": {                // 可能为 null（该页无默认图）！
        "id":number, "is_default":number, "kind":string,
        "combined_score":number, "identity_score":number, "frame_score":number,
        "image_path":string, "attempt_index":number, "generation_run_id":number, "task_id":number, "created_at":string
      } | null,                         // 候选图已按 run 隔离：一页在不同版本各有自己的默认图
      "candidates": [ /* 同 default_image 结构的数组，含所有候选图 */ ]
    }
  ],
  "sequence_checks": [ { "id":number, "is_consistent":number, "score":number, "issues":string, "problem_pages":string } ]
}
```
- 注意：
  - **没有** design 文档说的 `run_id` / `backup_images` / 顶层 `anchors` / `sequence` 包装；真实是嵌套 `characters` / `pages` / `sequence_checks`。
  - 图片元素字段是 snake_case：`image_path`、`is_default`、`combined_score`、`identity_score`、`frame_score`、`attempt_index`。
  - `image_path` 是**相对路径**（如 `assets/1/1/101.png`），前端必须拼成完整 URL：`${API_BASE}/${image_path}`（注意去掉可能多余的斜杠）。
  - `default_image` 可能为 `null`——必须兜底（显示占位图 / 提示「本页暂无图」），绝不能因 null 白屏。

### 2.5 `GET /api/pages/:pageId/images`
- 真实结构：`{ "images": [ { "id":number, "is_default":number, "kind":string, "combined_score":number, "identity_score":number, "frame_score":number, "image_path":string, "created_at":string } ] }`。
- 可作为「取某页封面 / 默认图」的备用路径（找 `is_default === 1` 的那条）。

### 2.6 `GET /assets/*`
- 图片二进制，路径即上面各处的 `image_path`。前端 `<img src="${API_BASE}/${image_path}">` 即可。

### 2.7 错误响应
- 统一为 `{ "error": string }`，配合 HTTP 4xx / 5xx。前端需对 404 / 网络错误做兜底 UI。

## 3. reader/ 工程与代码结构（建议）

- 脚手架：Vite + React + TS；后端基地址用环境变量 `VITE_API_BASE`（默认 `http://localhost:3000`，部署时注入）。
- 目录建议：
```
reader/
  index.html, vite.config.ts, tsconfig.json, package.json
  src/
    main.tsx, App.tsx            // 路由: / 与 /book/:id
    api/client.ts                // fetch 封装 + 基地址 + 错误归一化
    types.ts                     // Reader 数据类型（含预留位，字段对齐 §2 真实结构）
    hooks/useBook.ts             // 取 story + runs + runDetail，组装 ReaderPage[]
    pages/Shelf.tsx              // 书架
    pages/Reader.tsx             // 阅读器（含单页 / 跨页两种渲染）
    components/PageView.tsx      // 单页：满版图 + 浮层旁白
    components/SpreadView.tsx    // 双页跨页
    components/LangToggle.tsx    // 中 / 英 / 双语切换
    components/FontSizeControl.tsx
    components/ModeToggle.tsx    // 单页 / 跨页切换
    styles/*.css                 // 移动优先响应式样式
```

### 3.1 推荐的数据获取流程（阅读器打开某书）
1. `GET /api/stories/:id` → 拿到 `story` 元信息 + 每页文本 `pages[]`（含 `page_number`、`text_zh`、`text_en`）。
2. 取版本：`runs.runs.find(r => r.id === story.current_run_id)`（步骤 1 的 `story.current_run_id`）；缺失时才回退「最近一条 `completed` / `partial_failed`」。
3. `GET /api/runs/:runId` → 拿到每页 `default_image.image_path`。
4. 以 `page_number` 为键，把步骤 1 的文本与步骤 3 的图片合并成 `ReaderPage[]`（见 §5）。
- 书架封面：因 `GET /api/stories` 不带图，封面可二选一：①惰性加载——对每本书取最新 run 的 `pages[0].default_image.image_path`（多一次调用，建议并发 + 占位）；②先用标题卡占位，进入阅读器再加载图。推荐 ② 简单优先，① 作为增强。

## 4. 后端需配套的两处改动（在 backend/ 内修改，保持最小改动）

> 以下两项**均已完成**，此处保留作为设计记录。

1. **CORS**：已在 `backend/src/app.ts` 用 `onRequest` 钩子手动设置响应头实现（**零依赖，未引入 `@fastify/cors`**），放行方法 `GET,POST,PATCH,DELETE,OPTIONS`，来源由 `CORS_ORIGIN` 控制（默认 `*`，生产按部署域名收紧）。
2. **已发布过滤**：`storyService.listStories(status?)` 已支持可选 `status` 参数，`GET /api/stories` 支持 `?status=审批通过的作品`；无参时行为不变（管理壳兼容）。过滤在**后端**完成，草稿不会下发到客户端；reader 书架固定请求 `?status=审批通过的作品`。
   - 注意：不要改动管理壳 `frontend/` 的任何业务逻辑；后端改动应同时兼容现有管理壳调用（管理壳可能用无参调用，需保证无参时行为不变）。

## 5. 前端类型预留（关键，决定未来可扩展性）

在 `reader/src/types.ts` 中定义，**字段对齐 §2 真实结构**，并让组件对缺失字段**优雅降级**：
```ts
interface ReaderPage {
  pageNumber: number;
  textZh: string | null;   // 来自 page.text_zh（常为 null，需降级）
  textEn: string | null;   // 来自 page.text_en
  imageUrl: string | null; // 来自 default_image.image_path 拼 API_BASE；无图则 null
  audioUrl?: string;       // 预留：每页音频，后端未来入库；无则播放按钮置灰
  hotspots?: Hotspot[];    // 预留：热区，后端未来入库；无则不渲染
}
interface Hotspot { x:number; y:number; w:number; h:number; type:string; payload:string; }
```
- 音频：**已真实实现（非预留位）**。每页分段音频来自 `book-audio` 接口的 `segments[].audioUrls`（zh/en），阅读器底部含播放列表控制条（顺序播放分段、自动翻页）；`page.audioUrl` 整页兜底键保留但当前由分段音频驱动。
- 热区：图片上可点区域，`hotspots` 存在时渲染（`PageView.tsx` 已写好百分比定位覆盖层）；**但当前后端/管理壳尚无热区编辑与落库，`hotspots` 恒为 undefined、实际不渲染——属于待建功能（仅渲染壳就绪）**。
- `imageUrl` 为 null 时：显示占位图，禁止白屏。

## 6. 实现步骤（建议顺序）

1. 通读 §0 列出的源码文件 + `backend/src/types.ts` + `constants/status.ts`，逐接口确认真实响应结构（以源码为准，不抄 design 示例）。
2. 改 backend：CORS + stories 已发布过滤（小改动，跑 `npx tsc --noEmit` 验证）。
3. 脚手架 `reader/`（Vite + React + TS），配 `VITE_API_BASE`。
4. `api/client.ts` + `types.ts`（字段对齐 §2；封装备份 `JSON.parse(progress)` 与 `API_BASE + image_path` 拼接）。
5. 书架 `Shelf.tsx`：拉已发布列表（走 §4 的新过滤），网格封面（标题卡占位或惰性封面）。
6. 阅读器 `Reader.tsx`：按 §3.1 流程取数 → 组装 `ReaderPage[]` → 单页 / 跨页渲染 + 双语切换 + 字号 + 模式切换。
7. 移动优先样式 + 768px 断点跨页；手机滑动翻页（手写 touch 或轻量手势）。
8. 音频 / 热区预留位渲染（降级逻辑）。

## 7. 校验

- 后端：`cd backend && npm run typecheck` 必须 0 error；`npm run test`（20 个用例）应全绿。
- 前端：`cd reader && npm install && npm run build` 必须通过；`npm run dev` 在浏览器 / 响应式模拟器中验证：手机宽度单页滑动、Pad 宽度双页跨页、双语切换、字号调节、空 / 缺图 / 网络错误兜底不白屏。
- 接口集成：端到端「书架 → 打开 → 翻页」可直接实测：起 backend（`npm run dev`，`MOCK_AI=1` 零成本造数据）+ reader（`npm run dev`，5173），按 §8 方式造一本已发布书后刷新书架。
- 后端起不来时的替代联调：`reader/.env` 设 `VITE_USE_MOCK=true`，走 `reader/src/mock/fixtures.ts` 的本地示例数据（仅验 UI，不验接口）。

## 8. 禁止 / 范围外

- 禁止在 `reader/` 实现任何创作 / 管理功能（生成、审批、补画、改图等）。
- 禁止改动 `frontend/` 管理壳业务逻辑（热区编辑等新增功能需另开设计文档，在 `frontend/` 内新增模块而非改动既有业务逻辑）；音频相关表（`page_segments`/`audio_sets`/`page_audio`）已落地，禁止改动其 schema；**热区表尚未建立，新增热区功能需单独建表并经评审**。
- 不实现角色锚图画廊、不实现「创作对话」页。
- 不要主动 `git commit / push`（除非最终报告中明确说明并获确认）。

## 9. 交付

完成后输出报告：①新增 / 改动文件清单 ②后端两处改动说明（含 CORS 与 status 过滤的具体改法）③接口真实字段核对结果（列出你读源码确认的每个响应结构，标注与 design 文档不一致处）④前端类型与 §2 的映射说明 ⑤响应式各档位验证结果 ⑥mock 联调方式说明 ⑦预留位（音频 / 热区）降级逻辑说明 ⑧残留风险与建议。
