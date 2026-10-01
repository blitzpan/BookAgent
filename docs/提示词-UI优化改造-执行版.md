# BookAgent 界面改造 · 执行版提示词（权威版）

> 本文档是改造工作的**唯一权威指令**。执行方（AI 或工程师）应严格遵循。
> 配套记录：《现状梳理档案》《产品优化设计方案》。本文档以"真实代码"为准，已修正旧文档与代码不符之处。

---

## 一、角色与总目标

你是一位兼具**资深前端工程能力**、**产品思维**、**视觉/交互设计品味**与**儿童内容传播嗅觉**的改造专家。

你要对 BookAgent 项目的两套前端进行**页面布局、样式、交互**的彻底优化：
- **管理后台**（`frontend/`）：内部制作人用的"绘本生产工作室"。
- **阅读端**（`reader/`）：家长与孩子用的"绘本馆 / 阅读器"。

### 总目标（务必内化）
- **不是毕业设计、不是样子货**：交付的是"艺术品级"的绘本生产与阅读体验。
- **去除一切 AI 味**：当前后台是典型的"紫蓝渐变 + 灰底卡片"AI 脚手架味，必须彻底清除。
- **懂绘本受众**：后台面向"认真做书的内容生产者"，要专业、安静、有手作温度；阅读端面向"3–12 岁孩子 + 陪伴家长"，要温暖、沉浸、像翻开一本真的绘本。
- **具备传播思维**：书架这一屏、封面图、分享链接、阅读中的截屏体验，都是家长愿意发朋友圈的"传播杠杆"，要当门面来打磨。

### 改造边界
- **以改前端为主**；后端仅在被明确授权处改动（见决策 5）。
- 必要时可改框架/构建方式（如后台 Tailwind 由 CDN 转构建期、引入路由）。

---

## 二、已锁定的 5 项决策（不可偏离）

| # | 决策 | 说明 |
|---|------|------|
| 1 | **两套独立样式体系** | 后台=构建期 Tailwind + 自有暖色令牌；阅读端=手写 CSS 设计系统 + 自有深色令牌。**即使视觉相同也各写一份、零共享、零复用。** |
| 2 | **后台主色 赤陶 + 暖金点缀** | 主色 `--brand: #C8643C`（赤陶暖橙红）；点缀 `--gold: #E0A458`（暖金）用于评分/选中/高亮。**禁止紫、蓝、靛、青等科技色。** |
| 3 | **阅读端保留深色「绘本夜」** | 不做浅色切换，默认深色沉浸。当前为冷调深蓝 `#0f1020`，需调成**温暖近黑的"夜读灯"感**（带一点棕/暖的近黑，如 `#1a1410` 系），而非外太空感。 |
| 4 | **后台引入真实路由** | 用 `react-router-dom` 做真实路由：列表 `/`、详情 `/stories/:id`、热区 `/stories/:id/hotspots`。刷新不丢、可分享链接、可"在阅读端预览"互相跳转。 |
| 5 | **后端返回真实封面 `cover_url`** | 在 `GET /api/stories` 列表与 `GET /api/stories/:id` 详情中直接返回每本书的 `cover_url`（取该书最新 run 的首页默认图）。必要时后端补缩略图端点/字段。**已授权改后端。** |

---

## 三、⚠️ 代码与文档不一致清单（务必先读，避免被旧文档误导）

执行前必须知道：**旧文档多处与真实代码相反**，以下为已核实的真实现状。

1. **旧文档称"阅读端用 Tailwind CDN 且样式失效" —— 错误。**
   真实：阅读端 `reader/package.json` 中**完全没有 Tailwind**，样式全部来自手写 `reader/src/styles/global.css`（6.5KB）+ 内联 `style`/`className`。所谓"Tailwind 失效"无中生有。阅读端 100% 是自有 CSS 体系，应在此基础上**精修升级**，而非引入 Tailwind。
2. **旧文档称"两端都应统一 Tailwind 体系" —— 已被决策 1 推翻。**
   真实：仅后台用了 Tailwind（且是 CDN 运行时版）。阅读端无 Tailwind。按决策 1，**两套体系各自独立**，不要尝试统一。
3. **后台 Tailwind 是 CDN 运行时版**（`frontend/index.html` 中 `<script src="https://cdn.tailwindcss.com">`）——**不可上线、不稳、无法做生产构建优化**。必须改为**构建期 Tailwind（PostCSS + tailwind.config + 自有主题令牌）**，删除 CDN 引用。
4. **后台 `App.tsx` 是单页 state 切换视图**（StoryList / StoryDetail / HotspotSettings 用 `useState` 切），**没有路由**。路由改造仅针对后台（阅读端 `react-router-dom` 已装好）。
5. **后台存在大量 `dark:` 变体类但无暗色切换接线**（AI 脚手架默认残留）。按决策 2 暖色基调，应**移除暗色双套逻辑**，只保留单一暖色明快主题（除非后续单独要求）。
6. **阅读端封面当前是"纯文字"**（`global.css` 中 `.book-cover-title` 仅显示书名，无图），并非"程序随机色块"。无论哪种，结论一致：需由决策 5 提供真实 `cover_url` 以 `<img>` 展示真实封面（见 `.book-cover img` 已有样式，启用即可）。
7. 阅读端 `global.css` 中 `--accent: #ffd166`（金）已存在，与决策 3 的暖金点缀方向一致，可保留/微调，无需换成冷色。

---

## 四、两套系统的"真实现状"（执行基线）

### 管理后台 `frontend/`
- 技术：React 19 + Vite 6；Tailwind **CDN 运行时版**（待改为构建期）；无路由。
- 关键文件：`src/App.tsx`（单页视图切换）、`components/StoryList.tsx`、`StoryDetail.tsx`、`HotspotSettings.tsx`、`PageCard.tsx`、`AnchorGallery.tsx`、`AudioPlanModal.tsx`、`StoryConfigPanel.tsx`、`Loader.tsx`、`icons/MagicWandIcon.tsx`、`api/client.ts`、`types.ts`。
- 当前观感（待清除的 AI 味）：`from-purple-500 to-indigo-600` 渐变标题、`text-indigo-500` 图标、`bg-gray-50 dark:bg-gray-900` 底。

### 阅读端 `reader/`
- 技术：React 18 + Vite 5；`react-router-dom` 已装；**手写 CSS 设计系统** `src/styles/global.css`（CSS 变量主题）；无 Tailwind。
- 关键文件：`src/styles/global.css`、`pages/Shelf.tsx`、`pages/Reader.tsx`、`components/SpreadView.tsx`、`PageView.tsx`、`ModeToggle.tsx`、`LangToggle.tsx`、`FontSizeControl.tsx`。
- 当前主题（待精修）：`--bg:#0f1020 --panel:#1b1c2e --text:#fff --muted:#b9b9c9 --accent:#ffd166`，冷调深蓝"夜空"感。

### 后端 `backend/`
- Fastify；路由在 `src/routes/`（`stories.ts`、`runs.ts`、`tts.ts`、`hotspots.ts`、`pageImages.ts`）。
- 列表：`GET /api/stories` → `listStories(status)`；详情：`GET /api/stories/:id`。
- 封面来源：某书最新 run 的首页默认图（参考 `runs` 与 `pageImages` 的数据结构取图）。

---

## 五、设计原则（"去 AI 味"硬标准）

严禁以下"AI 脚手架味"，出现即不合格：
- ❌ 紫/蓝/靛渐变标题、科技 SaaS 配色（emerald/teal/sky/indigo）。
- ❌ 千篇一律的"白底圆角卡片 + 浅灰阴影 + 等宽网格"。
- ❌ 默认 Lucide/MDI 图标堆砌、无定制。
- ❌ 浮夸的弹跳入场动画、无意义的渐变光晕。
- ❌ 字重/字距不加思索的 `font-extrabold` 大标题。

必须的"艺术品级"取向：
- ✅ **有体温的材质感**：后台用"纸 / 墨 / 陶土"暖色体系；阅读端用"夜读灯"暖近黑 + 暖金。可考虑极轻的纸纹/颗粒叠层（不喧宾夺主）。
- ✅ **编辑级排版**：标题用有"绘本感"的展示字体（人文/圆体/衬线二选一，注意中文可行），正文用清晰易读字体；讲究字距、行高、留白节奏。
- ✅ **真实图像为主角**：封面、内页插画必须真实呈现并占据视觉重心，杜绝占位色块/纯文字封面。
- ✅ **克制的微交互**：翻页有"实体感"、按钮有"触感"反馈，但不过度动效；尊重 `prefers-reduced-motion`。
- ✅ **可访问性**：足够对比度、清晰焦点态、可键盘操作。

---

## 六、分系统改造指引

### A. 管理后台（构建期 Tailwind + 暖色体系 + 路由）

**基建**
- 删除 `index.html` 的 Tailwind CDN `<script>`；安装 `tailwindcss postcss autoprefixer`，建立 `tailwind.config.js`，在 `theme.extend` 中定义令牌：
  - `brand: #C8643C`、`brand-soft`、`gold: #E0A458`、`ink: #2B2620`、`paper: #FBF7F0`、`paper-2`、`muted`。
- 全局基础样式（字体、背景纸色、链接）写入 `src/index.css` 并 `@tailwind` 引入。

**布局（"绘本工作室"而非"后台表格"）**
- 引入 `react-router-dom`：`BrowserRouter` 包 `App`；路由 `/`、`/stories/:id`、`/stories/:id/hotspots`。
- 增加**左侧工作栏导航**（绘本库 / 热区 / 配音 / 设置），与右侧内容区构成"工作室"框架；首页即项目库。
- 列表由"表格"升级为**绘本书架/书脊网格**：每本用封面图（来自 `cover_url`）+ 书名 + 状态徽章，像真实书架，而非灰卡片列表。
- 详情页信息层级重排：用编辑式版面呈现元数据、页面缩略图条、操作区；主操作按钮用赤陶色。

**去 AI 味**
- 移除紫蓝渐变标题与 `indigo` 图标色；做一枚**手作感 wordmark**（文字标即可，避免渐变）。
- 移除无接线的 `dark:` 双套逻辑，统一暖色明快主题。
- 自定义少量 SVG 图标（延续现有 `MagicWandIcon` 的定制路线），避免通用图标库默认观感。

### B. 阅读端（手写 CSS 设计系统精修 + 暖夜 + 真实封面）

**主题**
- 在 `global.css` 中把冷调深蓝改为**暖近黑"夜读灯"**：如 `--bg:#1a1410`、`--panel:#241c16`，保留/微调 `--accent:#ffd066` 暖金。
- 暗角/纸纹：可选极轻的 radial 暖光晕，营造"台灯下读书"的氛围（克制）。

**书架 `Shelf.tsx`**
- 启用 `.book-cover img`：用后端 `cover_url` 渲染**真实封面图**（替换现有纯文字封面）。
- 书架背景从冷灰改为暖色"木/纸"质感；网格间距、圆角、阴影重新调校到精致。

**阅读器 `Reader.tsx` / `PageView` / `SpreadView`**
- 插画为绝对主角：满版呈现，外加暖色"画框/卡纸"边距，而非冷黑无边。
- 字幕 `.page-caption`：由硬白字改为**暖奶油色 + 柔和模糊底 + 舒适行高**，像书页下的温柔批注，避免刺眼。
- 导航：翻页做"实体翻页感"（轻微阴影/位移），进度指示改为"装订线/暖点"而非普通数字。
- 热区 `.hotspot`：保留暖金虚线语义，但精修气泡 `.hotspot-bubble` 的圆润与配色，使其像"绘本里跳出来的小贴纸"。
- 音频控制 `.audio-btn` / `.audio-control.glass`：暖色化，触感更强。

**通用**
- 所有过渡遵守 `prefers-reduced-motion`；触摸目标 ≥ 44px，适配移动端（已有 `viewport-fit=cover`，注意安全区）。

### C. 后端（仅决策 5 授权范围）

- 在 `listStories` / 详情序列化中计算并返回 `cover_url`（该书最新 run 首页默认图地址；若图较大，另提供 `cover_thumb` 缩略图，或在 `pageImages`/静态目录提供缩放端点）。
- 保持接口向后兼容（新增字段，不破坏既有字段）。
- 确认阅读端 `Shelf` 请求已能拿到 `cover_url` 并渲染。

---

## 七、执行纪律与验收

1. **先读真实代码再改**，以本文第三节"不一致清单"为避雷指南；旧文档的相反描述一律以代码为准。
2. **两套体系零共享**：后台 Tailwind 令牌与阅读端 CSS 变量各自定义、各自维护，即便颜色数值相同也写两遍。
3. **改动可运行**：后台 `npm run build`、阅读端 `npm run build` 均可通过；本地 `dev` 预览无报错。
4. **去 AI 味自查**：逐条对照第五节"硬标准"，提交前自检无紫蓝渐变、无 SaaS 卡片海、无浮夸动效。
5. **传播杠杆优先打磨**：书架封面真实化、分享链接可达（路由）、阅读截屏美观，这三项必须达标。
6. **不改业务逻辑与 AI 生成流程**，只动呈现层与决策授权的后端封面字段；如确需更大改动，先停下说明。

---

## 八、交付物

- 改造后的 `frontend/`（构建期 Tailwind、暖色体系、真实路由、真实封面书架）。
- 改造后的 `reader/`（暖夜主题、真实封面、精修阅读体验）。
- 后端 `cover_url` 字段（及必要缩略图支持）。
- 一份简短的"改动清单 + 预览方式"说明（含 dev/build 命令与本地访问地址）。
