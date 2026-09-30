> ⚠️ **文档更新说明（2026-09）**：
> 1. 本仓库已从「纯前端 Gemini demo」重构为 **monorepo + 后端**（`backend/` Fastify + sql.js 持久化，`frontend/` 管理壳，`reader/` 阅读端），并支持**多模型可插拔**（详见《BookAgent简介与配置说明.md》§二）。因此本文中「纯前端 / 无后端 / 无持久化 / 浏览器直连模型 API / `vite.config.ts` 的 `define` 注入」等描述已不适用——现在所有 AI 调用都在 **backend（Node）进程内**发出，配置由 `backend/src/env.ts` 自动读取 `.env.local`，模型按角色走 `gemini / qwen / bailian / seedream / ark / mock`（`mock` 为本地零成本假数据，由 `MOCK_AI=1` 开启）。`qwen` 与 `bailian` 是同一后端（阿里百炼）。
> 2. 本报告对**上游开源 BookAgent** 的能力差距分析仍有效；但「我们自己的仓库」已补齐：**交互式阅读器（`reader/`，翻页 + 双语 + 字号 + 音频播放，见《BookAgent简介与配置说明.md》§3.5）** 与 **资产结构化输出（库表 + `assets/` 落盘 + `/assets/*` 访问，见《数据库表结构与使用场景.md》）**。**2026-09 之后又新增了：中英双语 TTS（Edge TTS + `page_segments`/`audio_sets`/`page_audio` 三表，见 §二 功能 2、§六）、双语文本（`pages.text_zh`/`page_segments` 改写阶段产出）与音频播放（reader 播放列表 + 自动翻页 + 中/英/双语切音轨）。目前仅剩「图片热区」一块：reader 已写好渲染壳，但后端/管理壳尚无热区编辑与落库，无数据可渲染（见 §六、§七）。**
> 3. `buildRefsForPage` 已不再把上一页整图作为风格参考（图像模型会整体复刻参考图构图，导致第 N 页复制第 N-1 页），现仅传本页所需角色锚图；跨页风格统一由全局 `style` + 角色锚图保证——第三节、第四节、第七节相应描述已同步修正。

# BookAgent 代码分析报告

> 分析对象：`D:\workspace\git\huiBen\BookAgent\`（GitHub fork：https://github.com/blitzpan/BookAgent.git；ACL 2026 Findings 论文配套开源，React+Vite 前端 demo）
> 对照目标：`项目定义与目标.md`（Web 端 AI 双语交互式绘本生成+阅读系统）

---

## 一、技术栈与项目形态

| 维度 | 情况 |
| --- | --- |
| 框架 | React 19 + Vite 6 **前端**（管理壳 `frontend/` + 阅读端 `reader/`）+ **Fastify 后端 `backend/`**（承载全部 AI 调用与持久化） |
| 模型 | **多模型可插拔**：默认 `gemini`；国内可走 `ark`（单一 Key 覆盖 TEXT/IMAGE/VISION）或 `bailian/qwen`(文本/视觉)+`seedream`(图像)；本地开发用 `mock`（零成本）。详见《BookAgent简介与配置说明.md》§二 |
| 调用方式 | **后端 Node 进程内调用**（经 `backend/src/providers/` 抽象），前端只调后端 REST；不经过浏览器，无 CORS 问题 |
| 关键文件 | `backend/src/services/geminiService.ts`（9 个 AI 调用编排）、`backend/src/services/generationService.ts`（整书/单页生图编排：版本 run + 执行 task）、`backend/src/services/storyService.ts`、`backend/src/providers/`（各模型后端）、`backend/src/constants/generationConfig.ts`（生图参数单一来源）；前端 `frontend/src/App.tsx`、`reader/src/` |
| 资产形态 | **持久化**：sql.js 库（`backend/data/bookagent.db`）+ 图片落盘 `backend/data/assets/` 并经 `/assets/*` 访问；产出结构化的 `stories/pages/page_images/characters` 等资产 |

结论：它是**一个"生成闭环"的研究型 demo**，不是产品化系统。

---

## 二、实现了哪些功能（对照你的 6 大功能）

| 你的功能 | BookAgent 覆盖度 | 说明 |
| --- | --- | --- |
| 1. AI 绘本内容生成（含角色一致性） | ✅ 最强 | 这是它的核心卖点，一致性做得很完整（见第三节） |
| 2. 中英双语配音合成（TTS） | ✅ 已实现 | Edge TTS（`edge-tts-universal`）+ `page_segments`/`audio_sets`/`page_audio` 三表；旁白/对话/背景/音效分角色多音色；reader 含播放列表 + 自动翻页 + 中/英/双语切音轨（`backend/src/services/ttsService.ts`、`routes/tts.ts`） |
| 3. 交互式 Web 阅读器 | 🟡 部分（我们已建 `reader/`） | 上游仅画廊；本仓库已新增阅读端：书架 + 翻页 + 双语切换 + 字号调节（见《BookAgent简介与配置说明.md》§3.5） |
| 4. 图片热区交互 | ❌ 完全缺失 | 无任何热区概念 |
| 5. 双语资源与状态管理 | ✅ 已实现 | 改写阶段同步产出 `text_zh`+`text_en`（`storyService.ts`），TTS 产出中英两套音频，reader 按语言切换文本与音轨（自动翻页状态机见 `reader/src/components/PageView.tsx`） |
| 6. 资产输出与消费 | ✅ 已实现 | 已结构化：图（`page_images`）+ 双语文本（`pages`/`page_segments`）+ 双语音频（`page_audio`/`audio_sets`）落盘 `/assets/*`，reader 经 `book-audio` 接口消费；仅**图片热区**尚无数据（见功能 4） |

额外亮点（你未列、但值得借鉴）：**儿童内容安全双校验**（文本 check/sanitize + 图像 check），生成前/中/后多节点拦截。

---

## 三、核心流水线（主生成闭环）

编排入口：`backend/src/services/storyService.ts`（建故事/改写/配置/状态机）与 `backend/src/services/generationService.ts`（整书/单页生图闭环），逐页复用 `geminiService.ts` 的 9 个 AI 调用：

1. **文本安全校验** `safetyCheckText(check→sanitize)`
2. **评审+改写** `refineStoryForPageCount`：判断 `good_polish` / `rewrite`，把故事调整到目标页数（1–20），约束"常驻角色 ≤5 个"
3. **分页** `parseStoryIntoPages`：LLM 输出 JSON，每页 `{pageNumber, text, imagePrompt}`
4. **角色抽取** `extractCharacters`：LLM 抽 ≤5 个常驻角色 → `{id, name, visualDescription}`
5. **生成角色锚图（character sheet）**：每个角色调一次 `generateImage`，要求"纯色背景、全身、正面、中性表情"（符合参考资料里的 L2 锚图规范）
6. **逐页 Frame 级闭环**（核心）：
   - 按页检测"本页出现哪些角色"（名字显式命中；否则继承上一页），只把相关角色锚图喂给该页
   - `buildRefsForPage`：**只传入本页所需角色的锚图**作为参考图（已不再把上一页整图当风格参考，避免图像模型复刻上一页构图），最多 14 张（Gemini）/10 张（国内模型），由 `backend.maxRefs` 控制；跨页风格统一由全局 `style` + 角色锚图保证
   - `generateImage(refs)` → `safetyCheckImage` → `directorCheckIdentity`（ vs 锚图，0–1，<0.75 判不合格）→ `directorCheckFrame`（图文匹配，0–1）
   - 综合分 = `min(identity, frame)`；低于阈值则把 directors 的 issues 拼成 `FIX` 指令追加进 prompt，重试最多 `maxFrameRetry`(默认3) 次，取最高分图
7. **整书 Sequence 级闭环**（Director #2）：
   - `directorCheckSequence` 对所有页打分，返回 `isConsistent / score / issues / problemPages`
   - 低于 `sequenceThreshold`(默认0.8) 则对 `problemPages` 做"全局一致性修复"重画，最多 `maxSequenceRetry+1` 轮
8. **导出**：每页 `canvas` 合成（图+文字）下载 PNG；可下载角色锚图

---

## 四、一致性四层覆盖（对照《角色一致性方案对比》）

| 层 | 实现 | 位置/证据 |
| --- | --- | --- |
| L1 文本锁 | ✅ | 每页 prompt 注入 `CHARACTER LOCK`（角色 visualDescription 逐字复制）+ "未被提及的角色不得出现"硬规则；refine 阶段约束角色 ≤5 且不串味 |
| L2 图像条件 | ✅ | 每页只传入本页相关角色的锚图（干净全身图）作身份参考，**不再传入上一页整图**（图像模型会整体复刻参考图构图，导致第 N 页复制第 N-1 页）；Gemini 上限 14 张 / 国内模型上限 10 张；跨页风格统一由全局 `style` + 角色锚图保证 |
| L3 训练/适配器 | ❌ | 无 LoRA/IP-Adapter |
| L4 VLM 闭环 | ✅ | **三重 Director**（Frame 单页图文、Identity 本页 vs 锚图、Sequence 跨页）打分 0–1 + 自动修复重生成 |

→ 与你参考资料结论完全一致：**唯一四层全覆盖、闭环最完整的方案**。

---

## 五、如何使用

1. 安装 Node.js，进入目录 `npm install`
2. 配置 API Key：在 `.env.local` 配置（详见《BookAgent简介与配置说明.md》§2.3）。默认填 `GEMINI_API_KEY` 即可；国内网络建议配 `ark`（单一 Key）或 `qwen`+`seedream`
3. `npm run dev` 启动 Vite（开发代理已在 `vite.config.ts` 配好，解决国内模型 CORS）
4. UI 操作：粘贴故事 → 设页数(1–20)、风格、可选灵感图 → 展开 **Advanced (Loop Controls)** 调阈值/重试次数 → 点 **Create My Storybook**
5. 产出：角色锚图 + 逐页插画 + 两个 Director 的文字反馈；可下载单页/全部/锚图

### 两个必须注意的点（读码发现）
- **模型名需为真实可用值**：代码中默认 `gemini-3-pro-preview` / `gemini-3-pro-image-preview` 等是占位符，需替换成对应平台真实可用的模型名（各 provider 可在 `.env.local` 用 `*_MODEL_NAME` 覆盖）；国内 provider 有各自默认模型，通常无需改。
- **旧版"API_KEY/VITE_ 注入坑"已修复**：早期版本存在 `process.env.API_KEY` 与 Vite 不注入非 `VITE_` 变量的问题；现仓库已通过 `vite.config.ts` 的 `define` 显式注入 `process.env.*`，并在 `.env.local` 用 `loadEnv` 读取，按 §2.3 的变量名配置即可，无需再手动处理 `VITE_` 前缀。

---

## 六、与你期望目标的差距

一句话：**BookAgent 把你 6 大功能里的"功能 1（生成+一致性）"做到了行业顶配，但其余 5 个功能（TTS、阅读器、热区、双语、资产流水线）它一个都没有。** 它是"生成器"，而你要做的是"生成器 + 阅读器"的完整产品。

### 差距矩阵

| 你的目标 | 差距程度 | 具体缺口 |
| --- | --- | --- |
| 双语（中英） | 🟢 已实现 | 改写同步产出 `text_zh`+`text_en`，reader 支持中/英/双语切换（`storyService.ts` + `reader/src/components/PageView.tsx`） |
| TTS 配音 | 🟢 已实现 | Edge TTS 分角色多音色 + `page_audio`/`audio_sets`/`page_segments` 三表；reader 含播放列表/自动翻页/双语切音轨（`backend/src/services/ttsService.ts`、`routes/tts.ts`） |
| 交互式阅读器 | 🟢 已实现 | `reader/` 书架 + 翻页 + 双语 + 字号 + 音频播放（详见《BookAgent简介与配置说明.md》§3.5） |
| 图片热区 | 🟡 仅渲染壳 | reader `PageView.tsx` 已渲染 `hotspots` 覆盖层，但后端/管理壳无热区编辑与落库，`hotspots` 恒空、实际不渲染（待建，见 §七） |
| 资产输出供阅读端消费 | 🟢 已实现 | 图+双语文本+双语音频已结构化落库并经 `book-audio` 接口供 reader 消费；仅缺"热区配置"一块（见图片热区行） |
| 生成端一致性 | 🟢 可借鉴 | 这是 BookAgent 最强处，可直接借鉴其 L1+L2+L4 思路 |

### 关键架构差异
- 你计划：**离线生成端（产出素材）→ 前端阅读端（播放交互）** 分离。
- BookAgent：**纯前端单页 demo，浏览器直连模型 API，无生成/阅读分离、无持久化资产**。
- 因此 BookAgent **只能作为"生成端一致性"的算法参考**，不能直接当你的生成端或阅读端。

---

## 七、对你项目的可借鉴点

1. **生成端一致性闭环（最值得抄）**：`extractCharacters` → 生成 character sheet 锚图 → 逐页注入 `CHARACTER LOCK` + 本页角色锚图（**上一页整图已不再作为风格参考**，避免复刻上一页构图）→ 三重 Director 打分(<0.75 重生成)。这正好对应你《角色一致性方案对比》建议的"三层叠加"，且与你计划里的 SenseNova U1/FLUX 多参考图路线理念一致（只是它用 Gemini，现也可换国内模型）。
2. **角色"按需入镜"策略**：只把本页出现的角色锚图喂进去，并显式禁止未提及角色出现——避免了"全员乱入"的漂移，这正是多角色绘本的实操难点。
3. **不再把上一页整图传入参考图**：早期版本曾把上一页整图当"仅风格"参考，但图像模型会整体复刻参考图构图，导致第 N 页复制第 N-1 页（你实测发现的"第 2 页复刻第 1 页"正是此因）；现已移除，跨页风格统一由全局 `style` + 角色锚图保证，同样规避 cumulative drift。
4. **儿童安全双校验**（文本+图像）可作为你生成端的附加质量门。

### 不建议直接复用 / 需改造
- 模型需按你的计划抽象成 **多 Provider**（SenseNova U1 / FLUX 2 Pro / Seedream 等）以适配国内访问——仓库现有 `gemini/qwen/seedream/ark` 可插拔架构已为此打好基础，可参照扩展。
- 阅读器、中英双语 TTS、双语文本与资产结构化均已在自研中完成；**仅剩图片热区的"编辑/落库"一端待建**（reader 渲染壳已就绪，见 §六 图片热区行），这正是你文档里标注的"需自研"部分。

---

## 结论

BookAgent 与你期望结果的差距已大幅收敛：它把最难的"角色跨页一致性（功能1）"做对了，而你的"生成端一致性算法"已直接借鉴它；**功能 2（TTS）、3（阅读器）、5（双语资源）、6（资产结构化）均已在自研中完成**。目前**仅剩"功能 4 图片热区"一块未完**——reader 渲染壳已写好，但后端/管理壳尚无热区编辑与落库（待建，设计见本仓库后续讨论）。正确定位仍是：把 BookAgent 作为"生成端一致性算法"的高分参考，而非整体方案。
