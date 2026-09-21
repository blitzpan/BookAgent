# BookAgent 项目知识：配置运行 + 使用指南

> 本文档是我们对 BookAgent 项目的**自主梳理与知识沉淀**（非外部参考资料），供团队内部使用。
> 对应仓库：`D:\workspace\git\huiBen\BookAgent\`（GitHub fork：https://github.com/blitzpan/BookAgent.git）
> 关联文档：[BookAgent代码分析报告.md](./BookAgent代码分析报告.md)（功能差距 / 可借鉴点）

---

## 一、项目简介（背景）

BookAgent 是一个**面向儿童绘本的安全感知多智能体视觉故事书生成框架**，主打"端到端 + 闭环"：不是把文本生成和图像生成分开跑，而是联合规划、生成、校验、修复。

它是 ACL 2026 Findings 论文的配套开源 demo，形态为 **React 19 + Vite 6 纯前端单页应用**，无独立后端。所有 AI 调用原本硬编码走 Google Gemini，经我们改造后已变为**多模型可插拔**：每个角色（文本 / 图像 / 视觉）可独立选择 provider，从而能在国内网络下完全不依赖 Gemini 运行。

### 技术栈（改造后）
- 前端：React 19 + Vite 6
- 模型：按角色可插拔，provider 包括 `gemini`（默认）/ `qwen`（通义千问，国内）/ `seedream`（Seedream，国内）/ `ark`（火山方舟，国内，单一 Key 覆盖三角色）
- 关键文件：`services/geminiService.ts`（全部 AI 逻辑编排，导出签名不变）、`App.tsx`（UI + 主流程）、`services/providers/`（各模型后端实现）

### 核心流水线（生成闭环）
1. 文本安全校验（check → sanitize）
2. 评审 + 改写 `refineStoryForPageCount`：把故事调整到目标页数，约束常驻角色 ≤5 个
3. 分页 `parseStoryIntoPages`：每页产出 `{pageNumber, text, imagePrompt}`
4. 抽角色 `extractCharacters`：LLM 抽 ≤5 个常驻角色 → `{id, name, visualDescription}`
5. 生成角色锚图（character sheet）：每个角色一张干净全身参考图
6. **逐页 Frame 级闭环**：生成 → 身份校验 + 图文校验 → 低于阈值则把问题拼成 FIX 指令重画
7. **整书 Sequence 级闭环**：跨页一致性评分，对问题页做全局修复重画
8. 导出 PNG（逐页 / 全部 / 锚图）

### 一致性四层覆盖
- **L1 文本锁**：每页注入 `CHARACTER LOCK`（角色描述逐字复制）+ "未提及角色不得出现"硬规则
- **L2 图像条件**：每页只传入本页相关角色的锚图作身份参考（**不再传入上一页整图**，图像模型会整体复刻参考图构图、导致第 N 页复制第 N-1 页），Gemini 上限 14 张 / 国内模型上限 10 张（由 `backend.maxRefs` 控制）；跨页风格统一由全局 `style` + 角色锚图保证
- **L3 训练/适配器**：无
- **L4 VLM 闭环**：三重 Director（Frame / Identity / Sequence）打分 0–1 + 自动修复重生成

> 这是调研的多个开源方案里**唯一四层全覆盖、闭环最完整**的一个。

---

## 二、开发者指南：配置模型与运行系统

### 2.1 环境要求
- Node.js（建议 18+）
- 一个可用的模型 API Key（见 2.3）

### 2.2 安装与启动
```bash
cd D:\workspace\git\huiBen\BookAgent
npm install
# 编辑 .env.local，至少填入一个 provider 的 key（见 2.3）
npm run dev      # 启动后访问 http://localhost:3000/
```
没有 key 也能打开前端，但点击生成会因鉴权失败而报错。构建 / 预览：
```bash
npm run build
npm run preview
```

### 2.3 模型配置（核心）
所有 AI 调用按**角色**分发到 provider，通过 `.env.local` 的三个变量选择：
- `TEXT_PROVIDER`：文本类（抽角色 / 改写 / 分页 / 文本安全）
- `IMAGE_PROVIDER`：生图
- `VISION_PROVIDER`：需要"看图"的 VLM 校验（三个 Director + 图像安全）

**默认全部 `gemini`**，只需 `GEMINI_API_KEY`，行为与改造前 100% 一致（验收硬指标）。

#### 可选 provider 一览
| provider | 支持角色 | 国内可访问 | 所需 Key |
| --- | --- | --- | --- |
| `gemini` | TEXT / IMAGE / VISION | 否 | `GEMINI_API_KEY` |
| `qwen` / `bailian` | TEXT / VISION / **IMAGE** | 是（阿里百炼 DashScope：通义千问 + 通义万相） | `BAILIAN_API_KEY`（或 `QWEN_API_KEY`，同网关通用） |
| `seedream` | IMAGE only | 是（火山方舟） | `SEEDREAM_API_KEY`（或共用 `ARK_API_KEY`） |
| `ark` | TEXT / IMAGE / VISION | 是（火山方舟） | `ARK_API_KEY`（单一 Key 覆盖三角色） |

> `qwen` 与 `bailian` 是同一后端（阿里百炼平台）的两个名字：百炼与 DashScope 共用同一网关与 API Key，文本/视觉用通义千问（Qwen），图像用通义万相（Wanxiang / 万相 2.7）。现在它已支持**全角色**，可作为零 Gemini 的单一国内方案。

> 若某 provider 不支持被指定的角色（如把 `seedream` 配到 TEXT），会自动回退 `gemini` 并在控制台告警，不会报错卡死。

#### 推荐方案 A：全部走火山方舟（单一账号、单一 Key，零 Gemini 调用）
```bash
# .env.local
TEXT_PROVIDER=ark
IMAGE_PROVIDER=ark
VISION_PROVIDER=ark
ARK_API_KEY=你的火山方舟Key
```
豆包对话/视觉模型 + Seedream 生图都走同一域名，只需一个 Key。

#### 推荐方案 B：文本/视觉用通义千问 + 生图用 Seedream
```bash
# .env.local
TEXT_PROVIDER=qwen
IMAGE_PROVIDER=seedream
VISION_PROVIDER=qwen
QWEN_API_KEY=你的DashScopeKey
SEEDREAM_API_KEY=你的火山方舟Key   # 若已设 ARK_API_KEY 可留空（自动回退）
```

#### 推荐方案 C：全部走阿里百炼（单一账号、单一 Key，零 Gemini 调用）
```bash
# .env.local
TEXT_PROVIDER=bailian
IMAGE_PROVIDER=bailian
VISION_PROVIDER=bailian
BAILIAN_API_KEY=你的百炼/DashScope Key
# 可选覆盖：BAILIAN_TEXT_MODEL_NAME=qwen-plus / BAILIAN_VISION_MODEL_NAME=qwen-vl-plus
#          BAILIAN_IMAGE_MODEL_NAME=wan2.7-image（默认，通义万相2.7 多图参考生图）
```
文本（通义千问）+ 视觉校验（Qwen-VL）+ 生图（通义万相 2.7）都走同一网关，只需一个 Key，生图原生支持多张**角色锚图**参考，一致性闭环与 Gemini 一致。

> 提示：`qwen` 与 `bailian` 等价；若不想改 provider 名，直接写 `TEXT_PROVIDER=qwen` 等亦可。

#### 模型名覆盖（可选）
各 provider 默认模型可在 `.env.local` 覆盖：
- Gemini：`GEMINI_TEXT_MODEL` / `GEMINI_VISION_MODEL` / `GEMINI_IMAGE_MODEL`
- 百炼（qwen/bailian）：`BAILIAN_TEXT_MODEL_NAME`（默认 `qwen-plus`）/ `BAILIAN_VISION_MODEL_NAME`（默认 `qwen-vl-plus`）/ `BAILIAN_IMAGE_MODEL_NAME`（默认 `wan2.7-image`）；网关可用 `BAILIAN_BASE_URL` 覆盖
- Ark：`ARK_TEXT_MODEL_NAME` / `ARK_VISION_MODEL_NAME` / `ARK_IMAGE_MODEL_NAME`
- Seedream：`SEEDREAM_MODEL_NAME`
- 各 provider 还支持 `*_BASE_URL` 覆盖端点（如百炼默认 `/bailian-api`，可设为业务空间专属域名 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`）

#### 参考图上限
- Gemini：最多 14 张/页（均为角色锚图）
- Seedream / Ark：最多 10 张/页；百炼最多 9 张/页（均由 `backend.maxRefs` 控制，`geminiService.generateImage` 自动截断）；**全部为角色锚图，不再含上一页整图**
- 超出会自动截断，不会报错。

完整 env 变量速查见 `vite.config.ts` 的 `define` 段。

### 2.4 CORS / 开发代理
纯前端浏览器直调国内 API 会被 CORS 拦截，开发环境统一走 Vite 代理（`vite.config.ts`）：

| 代理路径 | 转发目标 | 用途 |
| --- | --- | --- |
| `/bailian-api` | `https://dashscope.aliyuncs.com`（前缀被 rewrite 去掉，保留后续完整路径） | 百炼文本/视觉（`/compatible-mode/v1/chat/completions`）+ 生图（`/api/v1/services/aigc/multimodal-generation/generation`） |
| `/ark-api` | `https://ark.cn-beijing.volcesengine.com`（保留后续路径） | Ark 文本/视觉 + 图像 |
| `/seedream-api` | `https://ark.cn-beijing.volcesengine.com/api/v3/images/generations` | Seedream 生图 |

前端以相对路径调用，由代理转发，**绕开浏览器 CORS**。生产 / 自部署需把对应 `BASE_URL` 设成完整地址（CORS 仍需服务端放行）。

### 2.5 架构概览
```
App.tsx
  └─ services/geminiService.ts   （编排层：组装 prompt/parts/schema，调用后端，解析结果）
       └─ services/providers/
            ├─ types.ts        ModelBackend 接口定义
            ├─ util.ts         文件/dataURL 转换、图像 prompt 组装、toDataUrl
            ├─ openaiLike.ts   通用 OpenAI 兼容 chat 工厂（bailian / ark 的 TEXT+VISION 共用）
            ├─ gemini.ts       GeminiBackend（默认，完整保留原 @google/genai 行为）
            ├─ bailian.ts      BailianBackend（文本 + 视觉 + 图像，阿里百炼 DashScope：通义千问 + 通义万相）
            ├─ qwen.ts         （向后兼容）重新导出 BailianBackend，避免历史引用断裂
            ├─ ark.ts          ArkBackend（文本 + 视觉 + 图像，火山方舟）
            ├─ seedream.ts     SeedreamBackend（图像，多参考图；文本/视觉不支持）
            └─ index.ts        后端注册 + 按角色分发（含不支持角色时的回退）
```
- `ModelBackend` 统一接口：`generateJSON({systemInstruction,parts,schema,role})` 与 `generateImage({prompt,referenceDataUrls,aspectRatio,imageSize})`。
- `geminiService.ts` 的所有导出签名**保持不变**，因此 `App.tsx` 无需改动。
- **默认全 `gemini`，行为与改造前 100% 一致**。

### 2.6 扩展新的 Provider
1. 在 `services/providers/` 下实现 `ModelBackend`（文本/视觉可选，不支持的方法抛错即可）；OpenAI 兼容的对话类可直接复用 `openaiLike.createChatJSONMethod`。
2. 在 `services/providers/index.ts` 注册，并在 `pick()` 中支持其名字。
3. 在 `vite.config.ts` 的 `define` 增加对应 key/端点变量，并在 `.env.local` 配置；如需绕过 CORS，再在 `server.proxy` 加一条代理。

### 2.7 常见问题
- **401/403**：API Key 缺失或权限不足；确认 `.env.local` 中对应 provider 的 Key 已填且生效（改完重启 `npm run dev`）。
- **429**：限流，调低并发或稍后重试。
- **模型名不对 / 返回格式异常**：确认覆盖变量拼写；非 JSON 返回会按原 fail-open 逻辑降级（文本返回空/原文，视觉视为通过），不会卡死整本书。
- **Seedream 字段变动**：官方 API 字段可能随版本变，若账号字段名不同，以火山引擎官方文档为准微调 `services/providers/seedream.ts`（或 `ark.ts`）的 `body`。
- **想 100% 还原原始行为**：不配置任何国内 Key，仅填 `GEMINI_API_KEY`，三个 PROVIDER 留默认 `gemini` 即可。

---

## 三、使用者指南：普通人如何使用

本节面向**不写代码的使用者**：你只需要一个已经部署/启动好的系统地址，和一个配置好的模型 Key（由开发/运维在 2.3 配好）。

### 3.1 开始前
- 打开系统页面（本地 `http://localhost:3000/`，或部署后的地址）。
- 确保开发侧已配置好至少一种模型（默认 Gemini，或国内方案 A/B）。

### 3.2 一步步生成你的绘本
1. **输入故事**：在 *Your Story* 文本框粘贴或写下你的故事草稿。系统会先做儿童内容安全校验，再自动改写以适配目标页数。
2. **设置页数**：*Number of Pages*（1–20，默认 6）。系统会把故事扩写/压缩到约这么多页。
3. **设置风格**：*Style* 文本框，决定整体画风与文字语气（默认 `whimsical, cute, soft-color children's picture-book style`）。可改成例如"水墨风""皮克斯动画风"等。
4. **（可选）上传灵感图**：*Inspiration Image* 上传一张参考图（PNG/JPG/GIF ≤10MB）。它只作为创作灵感影响分页设定，**不进入**后面的角色一致性闭环。
5. **（可选）高级闭环参数**：展开 *Advanced (Loop Controls)*（见 3.4），调严格度与重试次数。
6. **点击生成**：*Create My Storybook*，等待流水线跑完。

### 3.3 首页表单配置项对照
| 配置项 | 作用 | 默认值/范围 |
| --- | --- | --- |
| **Your Story** | 原始故事草稿，先过安全校验再被改写适配页数 | — |
| **Number of Pages** | 目标页数；改写阶段扩写/压缩，分页阶段严格拆成正好这么多页 | 1–20，默认 6 |
| **Style** | 全局画风/语气，注入改写、分页、锚图、每页 prompt 与一致性校验 | 默认 whimsical, cute, soft-color 儿童绘風 |
| **Inspiration Image** | 可选灵感图，仅影响分页灵感，不进一致性闭环 | 可选，≤10MB |

### 3.4 高级：闭环参数（通俗解释）
BookAgent 不是"生成一次就完事"，而是带**评分—重生成**闭环；四个参数控制"多严、重试几次"：

| 配置项 | 作用 | 默认值/范围 |
| --- | --- | --- |
| **Frame threshold** | 单页验收分数线：每页取 min(身份一致性分, 图文匹配分)，≥ 该值才通过 | 0–1，默认 0.75 |
| **Max frame retry** | 单页最多重画几次仍不达标就接受最佳一版；越大越精但越慢越贵 | 1–10，默认 3 |
| **Sequence threshold** | 整本书一致性分数线：全部页画完后评估跨页一致性，< 该值对相关页全局修复重画 | 0–1，默认 0.8 |
| **Max sequence retry** | 全局修复最多几轮（实际 `max+1` 次）；越大跨页打磨越久 | 0–5，默认 1 |

> 记忆口诀：**Frame 管"每一页对不对"，Sequence 管"整本书连不连"**；阈值调高 + 重试调高 = 质量更好但更慢更贵。普通用户保持默认即可。

### 3.5 生成后你会看到什么 / 如何导出
- **Reference Sheets**：自动生成的角色锚图（一致性锚点），可点 *Download refs* 下载。
- **Director #1 / #2 反馈**：闭环打分与问题说明文字，帮助了解质量。
- **画册**：逐页插画卡片，可横向滑动浏览。
- **导出**：*Download All Pages* 下载全部页 PNG；*Create Another Story* 重新开始。
- 若某页显示 *Image unavailable*，通常是该页模型调用失败/被安全拦截，可看下方错误文案或重试。

---

## 四、与我们绘本项目的定位（简述）
BookAgent 把你规划的 6 大功能里的**"功能1（AI 绘本内容生成 + 角色一致性）"**做到了行业顶配，但**其余 5 项（中英双语 TTS、交互式阅读器、图片热区、双语资源状态、资产结构化输出）它都没有**。正确定位是：把它作为**"生成端一致性算法"的高分参考**，而非整体方案。详见 [BookAgent代码分析报告.md](./BookAgent代码分析报告.md)。
