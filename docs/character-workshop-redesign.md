# 绘本工作室改版 · 详细设计 v2（修订稿）

> 术语约定：技术文档统一用「锚图」；前端页面叫「角色管理」，用户可见文案把锚图称作「角色形象」，前端不出现"锚图"二字。
> 状态：已评审通过，进入开发。

## 0. 本版修订清单（相对 v1）

| 编号 | v1 问题 | v2 处理 |
|---|---|---|
| A1 | `characters` 删了 `char_key` 切断一致性链路 | 保留 `char_key`，custom 创建时生成稳定 key |
| A2 | PUT 整批替换清掉 auto 绑定 | binding 加 `source='user'\|'auto'`，PUT 只动 user 行 |
| B1 | 主角可无锚图 → 角色先行失效 | custom/主角强制锚图+画风匹配，仅 auto 可空 |
| B2 | 替换锚图原地覆盖 + immutable 缓存 | 替换生成新 sheet id/新文件名，binding 改指新 id |
| C1 | 照片被当"风格参考"而非"身份参考" | 新增 `referenceRole:'identity'`，provider 据此组装提示词 |
| D1 | 命名不符要求 | 文档用锚图；前端角色管理 / 角色形象 |
| A3/A4 | 改写后脏绑定、软删故事后无法删角色 | 改写清 auto 绑定；引用检查排除软删故事 |
| B3/B4/B5 | 建故事非原子、多画风校验失效、改画风静默失配 | 建故事带 characterIds；画风 token 校验；改画风返回受影响绑定 |
| C2/C3/C4 | name 匹配、auto 跨画风门槛、多主角注入 | 用 name_in_story、主角排第一、补全描述门槛、只注入 1 主角 |
| D2/D3/D4 | 顶栏矛盾、详情页折叠、缺锚图提示晚 | 删顶栏导航、局部折叠、选主角实时校验 |
| E1/E2 | mock 守门、关键回归用例 | 写进实施步骤与测试清单 |
| F1 | 首次使用无引导 | 空状态引导先建角色 |

## 1. 数据模型 DDL（修订后）

```sql
CREATE TABLE IF NOT EXISTS characters (
  id                    INTEGER PRIMARY KEY,
  char_key              TEXT NOT NULL,
  name                  TEXT NOT NULL,
  category              TEXT NOT NULL DEFAULT 'auto',
  basic_attributes_json TEXT,
  visual_description    TEXT,
  source_story_id       INTEGER,
  created_at            TEXT,
  updated_at            TEXT,
  deleted_at            TEXT,
  FOREIGN KEY (source_story_id) REFERENCES stories(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_key ON characters(char_key);
CREATE INDEX IF NOT EXISTS idx_characters_category ON characters(category, deleted_at);

CREATE TABLE IF NOT EXISTS character_photos (
  id           INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL,
  photo_path   TEXT NOT NULL,
  created_at   TEXT,
  FOREIGN KEY (character_id) REFERENCES characters(id)
);
CREATE INDEX IF NOT EXISTS idx_photos_character ON character_photos(character_id);

CREATE TABLE IF NOT EXISTS character_sheets (
  id                    INTEGER PRIMARY KEY,
  character_id          INTEGER NOT NULL,
  style                 TEXT NOT NULL,
  sheet_image_path      TEXT NOT NULL,
  source_photo_ids_json TEXT,
  prompt_used           TEXT,
  created_at            TEXT,
  FOREIGN KEY (character_id) REFERENCES characters(id)
);
CREATE INDEX IF NOT EXISTS idx_sheets_character_style ON character_sheets(character_id, style);

CREATE TABLE IF NOT EXISTS story_character_bindings (
  id                  INTEGER PRIMARY KEY,
  story_id            INTEGER NOT NULL,
  character_id        INTEGER NOT NULL,
  character_sheet_id  INTEGER,
  role_in_story       TEXT NOT NULL DEFAULT 'supporting',
  name_in_story       TEXT,
  source              TEXT NOT NULL DEFAULT 'user',
  created_at          TEXT,
  FOREIGN KEY (story_id) REFERENCES stories(id),
  FOREIGN KEY (character_id) REFERENCES characters(id),
  FOREIGN KEY (character_sheet_id) REFERENCES character_sheets(id)
);
CREATE INDEX IF NOT EXISTS idx_bindings_story ON story_character_bindings(story_id, source);
```

开发阶段重建库，无数据迁移；`initDb()` 中旧 `characters` 的迁移代码删除。

## 2. 后端 API（修订后）

错误响应统一 `{ error: string }`；payload 走 JSON，图片用 dataURL。

### 2.1 角色库
- `GET /api/characters?category=custom|auto&q=` → `{characters:[{id,charKey,name,category,basicAttributes,visualDescription,sourceStoryId,sheets:[{id,style,url}],photoCount,createdAt}]}`
- `POST /api/characters` → `{name,category,basicAttributes,visualDescription}`，服务端生成 char_key → `201 {character}`
- `GET /api/characters/:id` → `{character: 含 photos[], sheets[]}`
- `PATCH /api/characters/:id` → 改 name/basicAttributes/visualDescription/category（转换需 confirmCategoryChange=true）
- `DELETE /api/characters/:id` → 软删除；引用检查排除软删故事（SQL 见设计原稿）

### 2.2 角色照片
- `POST /api/characters/:id/photos` → 仅 custom，`{images:[dataURL...]}` ≤10 → `201 {photos:[{id,url}]}`
- `DELETE /api/characters/:id/photos/:photoId`

### 2.3 锚图（前端文案：角色形象）
- `POST /api/characters/:id/sheets` → `{style,photoIds,extraPrompt?}` → `generateCharacterSheet` → 落盘 → `201 {sheet}`
  - 同画风已存在 → 409；带 `?replace=1` → 新建行拿新 id → 新文件名 → binding 改指新 id（绝不原地覆盖，绕开 immutable 缓存）
- `PATCH /api/characters/:id/sheets/:sheetId` 改 style
- `DELETE /api/characters/:id/sheets/:sheetId` 被引用时 409

### 2.4 故事 ↔ 角色绑定
- `GET /api/stories/:id/character-bindings` → `{bindings:[{id,characterId,characterName,category,charKey,sheetId,sheetUrl,sheetStyle,roleInStory,nameInStory,source}]}`
- `PUT /api/stories/:id/character-bindings` — 只替换 `source='user'` 行，保留 `source='auto'` 行
  - 生图/改写进行中 → 409
  - custom/主角：sheetId 必填且 style ∈ styleTokens(story.style)，否则 409 `{needSheet:true}`
  - auto：sheetId 可空
  - 传入 source='auto' 的 characterId → 扶正为 user 并校验
- `styleTokens(style)`：按 `[，,、]` 拆分；空用默认画风

### 2.5 建故事（原子）
`POST /api/stories` 增加 `characterIds?:number[]`，在 createStory 事务内插入 bindings（第一个 protagonist）；角色缺画风锚图则整体回滚 409。

### 2.6 改画风
`PATCH /api/stories/:id` 改 style → 返回 `affectedBindings:[{characterId,characterName,reason}]`（强提示，不阻断）。

### 2.7 改写
`rewriteStory` 成功后事务内 `DELETE FROM story_character_bindings WHERE story_id=? AND source='auto'`；custom 绑定保留。

### 2.8 生图流程
`runFullGeneration` 替换 `ensureAnchors`：
1. sheetId 非空 → readDataUrl(sheet.path) 作参考图，char_key 作内部 id，描述取 visual_description，主角排第一、name 用 name_in_story
2. sheetId 空且 source='auto' → extractCharacters + generateImage 生成临时锚图 → 落 characters(category='auto') + character_sheets → 回填 binding（source 保持 auto）
3. 合并参考图 → 现有逐页 runFrameLoop（buildRefsForPage 用 char_key）
`ensureAnchors` 拆为 `loadBoundSheets(storyId)` 与 `ensureAutoCharacters(...)`；`getRunDetail` 每 binding 一行兼容 AnchorGallery。

## 3. 提示词

### 3.1 锚图生成
`generateCharacterSheet(prompt, photos, style)` → `generateImage(prompt, photos, {aspectRatio:'1:1', referenceRole:'identity'})`。
`generateImage` opts 增 `referenceRole?:'identity'|'style'`（默认 style，向后兼容），透传 backend；provider 的 buildImagePrompt 据此组装：identity 时**所有**参考图标记为人物身份参考。
提示词：CHARACTER SHEET + style + visual_description + extraPrompt + PROFILE(年龄/性别) + "Use ALL attached reference photos to preserve the real person's facial identity... Redraw as illustrated character, NOT a photo" + CHILD-SAFE ONLY。

### 3.2 故事属性注入
只注入 1 个主角（role_in_story='protagonist'）的 basicAttributes + visual_description 到 `generateStoryFromTheme` / `refineStoryForPageCount` 的 systemInstruction 末尾；parseStoryIntoPages 不注入。保持"最多 5 个 recurring characters"约束。属性块用固定字段与分隔符包裹。

## 4. 前端

- 布局：顶栏只有 logo + 设置；左侧可折叠菜单（绘本库/角色管理）；路由 `/library`、`/characters`、`/characters/:id`、`/stories/:id`。全局折叠偏好存 localStorage，详情页用局部折叠。
- 命名：菜单/页面=角色管理；角色图=角色形象；生成按钮=生成角色形象；用户可见处不出现"锚图/毛图"。
- 新组件：AppShell、CharacterList、CharacterDetail、CharacterForm、PhotoUploader、SheetGallery、CharacterBindingPanel；复用 StylePicker/Modal/Loader/Lightbox/assetUrl。
- 空状态引导：角色管理为空 → 引导先建孩子角色；新建故事无 custom 角色 → 引导创建。
- 新建故事：选主角 + 选画风 → 实时校验主角有该画风角色形象（无则置灰+快捷入口）→ 生成传 characterIds → 建故事带 characterIds。
- 角色配置面板：主角换形象/换角色；添加角色（custom 强制选形象）；auto 临时角色只读；换画风后列受影响绑定。
- auto 角色：标注来源故事；补全描述后才允许跨画风生成；可扶正为 user（需确认）。

## 5. 存储
照片 `assets/characters/{cid}/photos/{id}.jpg`；锚图 `assets/characters/{cid}/sheets/{sheetId}.png`（id 进文件名）。imageStore 新增 saveCharacterPhoto/saveCharacterSheet。/assets/* 服务与 assetUrl() 不变。

## 6. 实施步骤
1. 重建 schema（char_key/source）清旧迁移 → 2. types + characterService 重写 → 3. imageStore 两个 save → 4. routes/characters.ts → 5. routes/characterBindings.ts → 6. createStory 带 characterIds → 7. 提示词改造（generateCharacterSheet + referenceRole + 属性注入，MOCK_AI 守门）→ 8. generationService 用 loadBoundSheets/ensureAutoCharacters → 9. rewrite 清 auto 绑定 / updateStory affectedBindings → 10. getRunDetail 兼容 → 11. AppShell + 路由 → 12. 角色管理页 → 13. NewStoryModal + StoryDetail → 14. 全链路回归 + 测试补全。

## 7. 测试清单
1. 主角缺锚图→409 needSheet；2. 画风不匹配（含多画风）→409；3. auto 绑定 PUT 后仍在；4. 替换形象→URL 变化、binding 指新 id；5. 改写清 auto 绑定留 custom；6. 软删故事后角色可删；7. 建故事失败回滚无孤儿；8. 属性注入 mock 可观察；9. generateCharacterSheet 传 identity、真实 provider 零构造；10. auto 入库 char_key 稳定、getRunDetail 兼容。

红线：全程 MOCK_AI=1、fetch 守门、不删用例换绿、不为过关调真实接口（见 docs/testing-prompt.md §5.3）。

## 8. 遗留建议（非阻断）
同名 auto 角色不自动合并；角色列表 N+1 可接受；默认 custom 优先展示；UI 说明改属性影响后续改写/新故事。
