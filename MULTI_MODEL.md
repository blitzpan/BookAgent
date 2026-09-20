# 多模型可插拔支持（Multi-Model Support）

BookAgent 在 `feat/multi-model-support` 分支上重构为"多模型可插拔"架构：
所有 AI 调用仍集中在 `services/geminiService.ts`，但内部按**角色**分发到可替换的
`ModelBackend` 实现（见 `services/providers/`）。

## 为什么能拆分

绘本生成的三类能力彼此独立，可分别指定不同模型：

| 角色 | 对应函数 | 说明 |
| --- | --- | --- |
| `TEXT` | `extractCharacters` / `refineStoryForPageCount` / `parseStoryIntoPages` / `safetyCheckText` | 纯文本/JSON LLM |
| `IMAGE` | `generateImage` | 图像生成（多参考图） |
| `VISION` | `directorCheckFrame` / `directorCheckIdentity` / `directorCheckSequence` / `safetyCheckImage` | 需要"看图"的 VLM 校验 |

一致性由 **L1 文本锁 + L2 多参考图 + L4 校验闭环** 保证，与具体厂商无关；
因此把任意角色换成国内模型，**不会破坏一致性核心**。

## 三个角色都可换成国内模型（关键）

改造的初衷是**国外模型（Gemini）在国内网络下难以直连**。因此三类能力都必须能切到国内 provider：

| 角色 | 可选 provider | 模型（可 env 覆盖） |
| --- | --- | --- |
| `TEXT` | `bailian`/`qwen`（通义千问）、`ark`（火山方舟豆包） | `qwen-plus` / `doubao-seed-1.8` |
| `IMAGE` | `bailian`（通义万相 Wanxiang）、`seedream`（Seedream）、`ark`（同账号 Seedream） | `wan2.7-image` / `seedream-5.0-pro` |
| `VISION` | `bailian`/`qwen`（通义千问视觉）、`ark`（豆包视觉） | `qwen-vl-plus` / `doubao-1.5-vision-pro` |

### 推荐：全部走火山方舟（单一账号、单一 Key）

火山方舟（Volcengine Ark）一个账号即可覆盖全部三个角色——豆包对话/视觉模型 +
Seedream 生图，都走同一域名，只需一个 `ARK_API_KEY`：

```bash
# .env.local
TEXT_PROVIDER=ark
IMAGE_PROVIDER=ark
VISION_PROVIDER=ark
ARK_API_KEY=你的火山方舟Key
```

> 若未配置任何国内 key，默认全 `gemini`，行为与重构前 100% 一致（验收硬指标）。
> `ark` / `seedream` 的图像 key 可共用：设了 `ARK_API_KEY` 后 `SEEDREAM_API_KEY` 可留空（自动回退）。

### 推荐：全部走阿里百炼（单一账号、单一 Key）

阿里云百炼（Bailian，与 DashScope 同一网关/Key）一个账号即可覆盖全部三个角色——
通义千问（文本）、Qwen-VL（视觉校验）、通义万相 Wanxiang（生图，原生多参考图），
只需一个 `BAILIAN_API_KEY`（或 `QWEN_API_KEY`）：

```bash
# .env.local
TEXT_PROVIDER=bailian
IMAGE_PROVIDER=bailian
VISION_PROVIDER=bailian
BAILIAN_API_KEY=你的百炼/DashScope Key
# 可选：BAILIAN_IMAGE_MODEL_NAME=wan2.7-image（默认，通义万相2.7 多图参考生图）
```

> `qwen` 与 `bailian` 等价（同一后端的两个名字），写 `TEXT_PROVIDER=qwen` 亦可。

## 架构

```
App.tsx
  └─ services/geminiService.ts   （编排层：组装 prompt/parts/schema，调用后端，解析结果）
       └─ services/providers/
            ├─ types.ts        ModelBackend 接口定义
            ├─ util.ts         文件/dataURL 转换、图像 prompt 组装（buildImagePrompt）、toDataUrl
            ├─ openaiLike.ts   通用 OpenAI 兼容 chat 工厂（bailian / ark 的 TEXT+VISION 共用）
            ├─ gemini.ts       GeminiBackend（默认，完整保留原 @google/genai 行为）
            ├─ bailian.ts      BailianBackend（文本 + 视觉 + 图像，阿里百炼 DashScope：通义千问 + 通义万相）
            ├─ qwen.ts         （向后兼容）重新导出 BailianBackend，避免历史引用断裂
            ├─ ark.ts          ArkBackend（文本 + 视觉 + 图像，火山方舟）
            ├─ seedream.ts     SeedreamBackend（图像，多参考图；文本/视觉不支持）
            └─ index.ts        后端注册 + 按角色分发（含不支持角色时的回退）
```

- `ModelBackend` 统一接口：`generateJSON({systemInstruction,parts,schema,role})` 与
  `generateImage({prompt,referenceDataUrls,aspectRatio,imageSize})`。
- `geminiService.ts` 的所有导出签名**保持不变**，因此 `App.tsx` 无需改动。
- **默认全 `gemini`，行为与重构前 100% 一致**。

## 配置（.env.local）

```bash
# 角色 -> provider（默认全 gemini）
TEXT_PROVIDER=gemini
IMAGE_PROVIDER=gemini
VISION_PROVIDER=gemini

# 全部走火山方舟（零 Gemini 调用，单一 Key）
# TEXT_PROVIDER=ark
# IMAGE_PROVIDER=ark
# VISION_PROVIDER=ark
# ARK_API_KEY=你的火山方舟Key
```

可选 provider：`gemini` / `qwen` / `bailian` / `seedream` / `ark`。
- `ark` 支持全部三个角色。
- `bailian` / `qwen` 支持全部三个角色（阿里百炼：通义千问文本 + Qwen-VL 视觉 + 通义万相生图）。
- `seedream` 只支持 `IMAGE`，若被误配到 `TEXT`/`VISION` 会自动回退 `gemini` 并告警。

## CORS / 代理

纯前端浏览器直调国内 API 会被 CORS 拦截，开发环境统一走 Vite 代理（见 `vite.config.ts`）：

| 代理路径 | 转发目标 | 用途 |
| --- | --- | --- |
| `/bailian-api` | `https://dashscope.aliyuncs.com`（前缀被 rewrite 去掉，保留后续完整路径） | 百炼文本/视觉（`/compatible-mode/v1/chat/completions`）+ 生图（`/api/v1/services/aigc/multimodal-generation/generation`） |
| `/ark-api` | `https://ark.cn-beijing.volcesengine.com`（保留后续路径） | Ark 文本/视觉（`/api/v3/chat/completions`）+ 图像（`/api/v3/images/generations`） |
| `/seedream-api` | `https://ark.cn-beijing.volcesengine.com/api/v3/images/generations` | Seedream 生图 |

前端以相对路径调用（如 `fetch('/ark-api/api/v3/chat/completions', ...)`），由代理转发，
**绕开浏览器 CORS**。生产/自部署可把对应 `BASE_URL` 设成完整 URL（注意 CORS 仍需服务端放行）。

## Seedream / Ark 图像 对接说明

- 走火山引擎方舟（Volcengine Ark）图像生成接口 `/api/v3/images/generations`。
- 多参考图字段：`image_ref`（数组，每项 `{ image: <dataURL> }`），参考图上限 10 张
  （Gemini 为 14，由 `backend.maxRefs` 控制，`geminiService.generateImage` 自动截断）。
- 返回结构兼容 `data[].b64_json` / `data[].url` / `generated_images` 多种形态。
- ⚠️ Seedream 官方 API 字段可能随版本变动；若你的账号字段名不同，请以火山引擎
  官方文档为准微调 `services/providers/seedream.ts`（或 `ark.ts`）的 `body`。

## Qwen / Ark 文本 + 视觉 对接说明

- 走 OpenAI 兼容 `/api/v3/chat/completions`（DashScope 为 `compatible-mode/v1`，Ark 为 `api/v3`）。
- 文本角色用 `*_TEXT_MODEL_NAME`；视觉角色用 `*_VISION_MODEL_NAME`（多模态 VLM）。
- 使用 `response_format: { type: "json_object" }`，由 prompt 约束输出 JSON 结构，
  因此忽略 `geminiService` 传入的 Gemini 风格 `schema`（与 Gemini 的 `responseSchema` 不同）。
- 看图时把 `parts` 中的 `inlineData` 转成 OpenAI 的 `image_url`（dataURL）塞入消息。
- 若返回非 JSON，`geminiService` 的 try/catch 会按原 fail-open 逻辑降级
  （文本：返回空/原文；视觉：视为通过），不会卡死整本书。

## 百炼（Bailian）图像 对接说明

- 走阿里百炼（DashScope 网关）万相 2.7 的 `multimodal-generation/generation` 同步端点。
- 多参考图字段：在 `input.messages[].content` 中以多个 `{ "image": "<dataURL>" }` 传入
  （百炼支持 base64 `data:...;base64,...`），文本 prompt 以 `{ "text": "..." }` 放在最后；
  上限 9 张（由 `backend.maxRefs` 控制，`geminiService.generateImage` 自动截断），
  与原 Gemini（14）/ Seedream·Ark（10）一致地支持"上一页(风格)+角色锚图"条件输入。
- 返回 `output.choices[].message.content[].image`（图片 URL，24h 有效），
  由 `util.toDataUrl` 转回 dataURL 以统一下游处理。
- 默认模型 `wan2.7-image`（或 `wan2.7-image-pro`）；若走更老的 wanx 模型或业务空间专属域名，
  可通过 `BAILIAN_IMAGE_MODEL_NAME` / `BAILIAN_BASE_URL` 调整。

## 其它 provider 接入

新增一个 provider 只需：

1. 在 `services/providers/` 下实现 `ModelBackend`（文本/视觉可选，不支持的方法抛错即可）。
   OpenAI 兼容的对话类 provider 可直接复用 `openaiLike.createChatJSONMethod`。
2. 在 `services/providers/index.ts` 注册，并在 `pick()` 中支持其名字。
3. 在 `vite.config.ts` 的 `define` 与 `.env.local` 增加对应 key/端点变量；
   若需绕过 CORS，再在 `server.proxy` 加一条代理。
