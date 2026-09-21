# 任务：为 BookAgent 编写测试 + 自动化执行 + 自动修复闭环（全 mock，最终只报人工项）

你是一名资深测试 / 全栈工程师，且具备**自我修复能力**。本仓库是绘本生成系统 BookAgent（Fastify + SQLite 后端 `backend/`、管理壳 `frontend/`、只读阅读端 `reader/`）。

你要交付的不是「一份测试方案」，而是一套**能自动运行、根据失败自动改代码、循环直到通过，最后只把需要人拍板的结果输出**的闭环。流程分两大阶段：

- **阶段一（搭建）**：实现 mock provider + 测试脚手架 + 四类场景用例（见 §2–§4）。
- **阶段二（闭环）**：跑测试 → 读失败 → 自动修（修用例 or 修产品代码） → 重跑，直到绿或达到上限；把「修不动 / 需决策」的列为人工项（见 §5）。
- **终局输出（§6）**：只输出需要人工介入处理的结果清单；自动化已修复的部分只在运行日志里留痕，不在最终消息里堆砌。

## 0. ⛔ 最高优先级硬约束：绝对不能调用真实大模型 / 生图 API

- 所有大模型 / 生图调用都经由 `backend/src/providers/*` 抽象（`getTextBackend()/getImageBackend()/getVisionBackend()` → `ModelBackend.generateJSON / generateImage`），编排层在 `backend/src/services/geminiService.ts`。
- **测试必须把这些调用全部走 mock**，否则会真实调用 Gemini / 百炼 / 火山等付费接口，造成大量金钱损失。
- 实现手段：新增 `backend/src/providers/mock.ts`，并通过环境变量 `TEXT_PROVIDER=mock IMAGE_PROVIDER=mock VISION_PROVIDER=mock` 切换；测试中**绝不**设置真实 `GEMINI_API_KEY / ARK_API_KEY / DASHSCOPE_API_KEY`。
- **防御性兜底**：所有测试启动前，patch `globalThis.fetch`（以及 `undici` 的 fetch）为「任何非 localhost/127.0.0.1 的请求直接 reject」。这样即便误配真实 provider，也会立即报错而非真的花钱。
- 每条大模型相关用例都断言「mock 的 `generateJSON`/`generateImage` 被调用，且真实 provider 未被构造」。
- **闭环红线**：自动修复循环（§5）**不得以任何方式弱化本条**——禁止为了「让测试变绿」而把 provider 切回真实、删除 fetch 守门、或注释掉金钱安全断言。若某用例只有真实调用才能过，它就是 §6 的人工项，绝不允许用真金白银去换绿。

## 1. 实现前必读源码（以源码为准，不抄设计文档）

- `backend/src/providers/index.ts`、`backend/src/providers/types.ts`：provider 分发与 `ModelBackend` 接口（`generateJSON` 入参含 `role`/`schema`/`systemInstruction`/`parts`；`generateImage` 入参含 `prompt`/`referenceDataUrls`/`aspectRatio`/`imageSize`，返回 `data:...;base64,...`）。
- `backend/src/services/geminiService.ts`：抽角色、改写、分页、三个 Director、安全检测、生图——**所有 LLM 调用点**。
- `backend/src/services/generationService.ts` + `backend/src/services/taskRunner.ts`：`runFullGeneration`（scope=full 整书）与 `runSinglePage`（scope=single_page 单页补画）的执行逻辑与 `recordImage`/`getRunDetail`。
- `backend/src/routes/stories.ts`、`backend/src/routes/runs.ts`：接口契约（`POST /api/stories`、`POST /api/stories/:id/rewrite`、`POST /api/stories/:id/generate`、`POST /api/pages/:pageId/images`、`POST /api/stories/:id/publish`、`GET /api/runs/:runId` 等）。
- `backend/src/db/sqlite.ts`：DB 初始化（确认测试可用独立 DB）。
- `reader/`：阅读页面与 `VITE_API_BASE` / `VITE_USE_MOCK` 环境变量。
- `frontend/`：创建 / 改写 / 生图 UI（仅供可选 UI 级 Playwright 参考）。

## 2. 测试架构

```
backend/tests/                 # 后端集成测试（vitest + Fastify inject）
  setup.ts                     # 设 mock provider env + patch fetch 防泄漏 + buildApp
  mock-provider.test.ts        # 金钱安全险：mock 被用、真实 provider 0 构造、fetch 守门生效
  auto-generate.test.ts        # 场景 1：自动生成整书
  manual-generate.test.ts      # 场景 2：手动单页补画
e2e/                          # Playwright 端到端（移动端 + Pad 端阅读）
  global.setup.ts              # 起 backend(mock)+seed 已发布书；起 reader
  reader.mobile.spec.ts        # 场景 3
  reader.pad.spec.ts           # 场景 4
```

- 后端集成测试用 **Fastify `app.inject()`**（Fastify 自带，无需端口、无需真实网络）。
- 把 `backend/src/index.ts` 里「建 app + registerRoutes + initDb」抽成 `backend/src/app.ts` 的 `buildApp()` 导出，`index.ts` 改为调用它后再 `listen`。测试 `import { buildApp }` 后 `await app.ready()` 并 `initDb()`。
- DB 隔离：每条测试文件用独立临时 SQLite（sql.js 默认内存库，vitest 默认每文件独立进程即天然隔离；更稳则加 `SQLITE_TEST_FILE=os.tmpdir()/xxx.sqlite` 测试后删除）。
- Playwright 用 `webServer` 自动拉起「backend(mock)+seed」与「reader」，再按视口跑。

## 3. Mock Provider 设计（核心：保证零真实调用）

新增 `backend/src/providers/mock.ts`，导出 `createMockBackend(): ModelBackend`，并在 `backend/src/providers/index.ts` 的 `pick()` 中注册 `mock`（三个角色都返回它）。行为（schema 感知，使整条流水线在无真实模型下产出合法数据）：

- `generateJSON({ schema, systemInstruction, role })`：
  - 若 `schema.properties.characters` 存在 → 返回 `{ characters: [{ id:"char_1", name:"主角", visualDescription:"一只圆滚滚的小猫，橘色，蓝眼睛" }] }`。
  - 否则若 `schema.properties.pages` 存在 → 从 `systemInstruction` 解析「EXACTLY N pages」的 N（默认 6），返回 `{ pages: Array.from({length:N}, (_,i)=>({ pageNumber:i+1, text:`第 ${i+1} 页示例文字`, imagePrompt:`示例画面描述 ${i+1}` })) }`。
  - 否则若含布尔评分字段（`isAcceptable`/`isConsistent`/`isSafe`）→ 返回 `{ isAcceptable:true, isConsistent:true, isSafe:true, score:0.95, issues:[], problemPages:[] }`。
  - 兜底 → `{}`。
- `generateImage()`：返回**合法最小 PNG data URL**（1×1 透明 PNG 的 base64）。
- `maxRefs:14`、`supportsVision:true`。
- 不触碰任何网络。

> 不要用 `vi.mock('@google/genai')` 作主方案（只对默认 gemini 生效，换 provider 即失效）。**mock provider 是主方案**。

## 4. 四类场景（测试内容）

**场景 1 自动生成（auto-generate.test.ts）**——`app.inject` 跑整书流水线：
1. `POST /api/stories` 建故事（`target_page_count=4`）。断言 201 + 返回 `id`，初始 `status`「新建」。
2. `POST /api/stories/:id/rewrite`（同步）。断言含 `refined_text` 与分页 `pages`（长度 4），状态「改写完成待生图」。
3. `POST /api/stories/:id/generate`（full）→ `runId`，状态「生图中」。
4. 轮询 `GET /api/runs/:runId` 直到 `completed`/`partial_failed`。
5. 断言每页 `default_image` 非空、`image_path` 合法（`assets/...`）；`sequence_checks`≥1 条；`characters` 锚图 `sheet_image_path` 非空。
6. `POST /api/stories/:id/publish` → 状态「审批通过的作品」。
7. `GET /api/stories?status=审批通过的作品` 能查到该书。
8. 金钱安全断言：spy 确认 mock `generateJSON`/`generateImage` 被调用；真实 provider 构造 0 次。

**场景 2 手动生成（manual-generate.test.ts）**——单页补画（scope=single_page）：
1. 复用场景 1 步骤 1–4（抽成 `seedBook()` 夹具）先产出整书。
2. 取某 `pageId`（`GET /api/stories/:id`）。
3. `POST /api/pages/:pageId/images` → `runId`（scope=single_page），轮询完成。
4. 断言该页 `candidates` +1，**不翻默认**（除非另行调翻默认接口）。
5. 金钱安全断言同上。
6. 可选 UI 级 Playwright（frontend/）：建书→改写→生成整书（场景1 UI 版）；对某页补画（场景2 UI 版）。

**场景 3 移动端阅读（reader.mobile.spec.ts，~390×844，isMobile+touch）**：
- 书架出现已发布书 → 进 `/book/:id`。
- 屏宽 <768 默认**单页**：只显示一页满版图 + 双语旁白；滑动/点按翻页，断言页码 +1、图切换。
- 语言「中文 / English / 双语」切换：断言旁白变化（mock 数据 `text_zh` 常为 null，需断言降级不白屏）。
- 字号三档：断言 `.page-caption` 的 `font-size` 改变。
- 缺图兜底：临时改 `VITE_API_BASE` 指无图服务，断言出现「本页暂无图」占位而非白屏。

**场景 4 Pad 端阅读（reader.pad.spec.ts，~820×1180 或 1024×768）**：
- 同书 `/book/:id`：屏宽 ≥768 默认**双页跨页**（左右两页并排）。
- 「单页 / 跨页」切换按钮生效。
- 跨页翻页一次翻「一对」页（页码形如 `1-2 / 4`）。
- 语言 / 字号切换在 Pad 同样生效。
- 无横向溢出、图片 `object-fit` 铺满、无滚动白边。

**公共断言（移动 & Pad）**：不白屏、图失败有占位、双语降级不报错、`page.on('pageerror')` 收集断言为空。

## 5. 自动化执行与自动修复闭环（核心）

> 本阶段由你（AI）循环执行：**跑测试 → 读失败 → 判因 → 修 → 重跑**，目标是让所有「可自动修复」的用例变绿。

### 5.1 执行入口
```
# 后端集成测试（mock 全开，真实 key 置空）
TEXT_PROVIDER=mock IMAGE_PROVIDER=mock VISION_PROVIDER=mock \
GEMINI_API_KEY= ARK_API_KEY= DASHSCOPE_API_KEY= \
npx vitest run            # backend/tests

# 端到端（Playwright 会按 webServer 自动起 backend(mock)+seed 与 reader）
npx playwright test        # e2e
```
合并命令建议：`npx vitest run && npx playwright test`，任一失败即进入修复循环。

### 5.2 失败分类与处置规则
每轮收集失败，按根因分类，分别处置：

| 类别 | 判定特征 | 处置 |
|---|---|---|
| **A. 用例问题** | 选择器脆弱、期望页数/状态字符串写错、缺 seed、断言过严（如要求真实图片尺寸） | 改测试 / fixture / 配置，不动产品代码 |
| **B. 环境/基建** | 缺依赖、Playwright 浏览器未装、端口冲突、seed 脚本报错 | 用安装命令修复（如 `npx playwright install chromium`），不改业务 |
| **C. 产品 bug** | 后端崩溃、状态机流转错、图片路径落库错、reader 白屏/异常 | **最小外科式**改 `backend/` 或 `reader/` 对应代码 |
| **D. 人工项（不可自动修）** | 需真实 LLM/付费接口才能验证；需产品/设计决策；需改 DB schema 或公开 API 契约；需改动 `frontend/` 业务逻辑或需求澄清；修复会触碰 §0 红线 | **不修**，记入 §6 人工清单，附原因 |

### 5.3 循环红线（绝对遵守）
1. **不弱化 §0 金钱安全**：不得切回真实 provider、不得删 fetch 守门、不得注释金钱安全断言来换绿。
2. **不靠删/跳过用例换绿**：失败必须修根因，或移入 D 类人工项并说明理由；禁止 `@skip`/`xdescribe`/删断言式「修复」。
3. **外科式改动**：只改与失败直接相关的代码；不顺手重构、不改动无关模块、不碰 `frontend/` 业务逻辑 / DB schema / 公开 API 契约（这些算 D 类）。
4. **可复现**：每次修复后必须重跑对应 suite 验证变绿；不得「看日志猜已修」而不重跑。
5. **防死循环**：同一失败连续 `K` 轮（建议 K=2）无法收敛，立即转为 D 类人工项并标注「已尝试 N 次」，不再硬刚。

### 5.4 终止条件
- 所有 A/B/C 类用例变绿 → 闭环成功。
- 达到上限 `MAX_ITER`（建议 12）仍有未绿 → 残余并入 D 类。
- 仅剩 D 类（含确需真实接口 / 需决策项）→ 闭环结束，进入 §6。

## 6. 最终输出规范（只输出需要人工介入的结果）

闭环结束后，**最终给用户的消息只包含「需要人工介入处理的结果」**，格式如下。自动化已修复的 A/B/C 类只在运行日志留痕，不在最终消息堆砌（可一句总结「共自动修复 X 处，四类核心场景回归全绿」）。

```
## 需要人工介入（共 N 项）
### [类型] 标题
- 现象 / 阻塞点：…
- 已尝试：…（自动修复阶段做过什么、为何修不动）
- 建议处理：…
- 是否阻塞发布：是 / 否

（逐项列出）
```

**典型人工项（参考，实际以闭环结果为准）**：
- reader 的音频 / 热区播放为预留位，无法自动化测真实播放 → 建议人工确认降级文案与占位。
- 角色锚图画廊 UI 未实现 → 建议人工确认是否本期范围，或补实现后再测。
- Playwright 浏览器需联网下载，CI / 内网环境需人工配置或缓存。
- 某用例经 N 轮未绿，疑似真实 bug 或需求歧义 → 贴最后失败 + 已尝试修复，请人拍板。
- 任何需要真实 LLM / 付费接口才能验证的功能 → 明确标注「需真金白银，已用 mock 覆盖等价逻辑，真实链路建议人工抽样」。

**末尾结论**：给出「核心链路（建书→改写→自动/手动生成→发布→移动/Pad 阅读）自动化是否已全绿、是否存在阻塞发布的硬伤」的一句判定。

## 7. 运行与依赖

- `backend/package.json` 增加：`devDependencies` 加 `vitest`、`@playwright/test`；`scripts` 加 `"test":"vitest run"`、`"test:e2e":"playwright test"`（e2e 也可放仓库根 `e2e/`）。
- 测试脚本启动**先写 mock env**（见 §5.1），`GEMINI_API_KEY=` 等显式置空。
- Playwright 首次 `npx playwright install`（浏览器二进制）。
- 不提交真实 key、不提交 `.env.local` / key 文件；不改 `frontend/` 业务逻辑、不改 DB schema。

## 8. 禁止 / 范围外

- 禁止任何真实大模型 / 生图 API 调用（见 §0，且 §5.3 红线再强调）。
- 禁止提交真实 Key。
- 不测试 / 不实现未实现功能（角色锚图画廊、创作对话页、音频/热区真实播放仅为预留位，断言「降级不渲染/不白屏」即可）。

## 9. 交付

- 过程：每轮修复在运行日志记录「失败 → 分类 → 改动文件 → 重跑结果」。
- 最终消息（给用户）：**仅 §6 的人工项清单 + 一句核心链路绿/不绿结论**。
- 附带：新增/改动文件清单（含 `providers/mock.ts`、`app.ts` 抽出、`backend/tests/*`、`e2e/*`）。
