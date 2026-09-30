// Mock 多模型后端：零真实 API 调用，但**尽量像真模型一样返回内容**。
//
// 设计原则（与真实调用的差异只在于「内容从哪来」，不在于「结构」）：
//  1) 所有返回严格贴合 geminiService 里声明的 responseSchema，字段一个不少；
//  2) 内容是「读请求»再作答」：分页文本来自用户原文的真实切分，角色来自原文里
//     真正出现的名字，Director 分数随输入确定性抖动（同一输入永远同一结果）；
//  3) 生图不是 1×1 占位图，而是本地画出的一张真 PNG（见 ./mockImage）；
//  4) 未识别的 schema 按类型自动补全，保证将来新增调用点也不会「缺数据」。
//
// 仅用于本地/测试。绝不包含任何真实 API Key 或网络请求。

import type {
  ModelBackend,
  GenerateJSONArgs,
  GenerateImageArgs,
  Part,
} from "./types";
import { paintMockImage } from "./mockImage";

// ============================ 请求上下文 ============================

interface RequestCtx {
  system: string;
  /** 所有 text part 拼接。 */
  user: string;
  /** 内联图片（参考图 / 被评估的图）。 */
  images: { data: string; mimeType: string }[];
}

function readCtx(args: GenerateJSONArgs): RequestCtx {
  const texts: string[] = [];
  const images: { data: string; mimeType: string }[] = [];
  for (const p of args.parts ?? []) {
    if (isTextPart(p)) texts.push(p.text);
    else if (isInlinePart(p)) {
      images.push({ data: p.inlineData.data, mimeType: p.inlineData.mimeType });
    }
  }
  return { system: args.systemInstruction ?? "", user: texts.join("\n"), images };
}

const isTextPart = (p: Part): p is { text: string } =>
  typeof (p as { text?: unknown }).text === "string";
const isInlinePart = (p: Part): p is { inlineData: { data: string; mimeType: string } } =>
  !!(p as { inlineData?: { data?: unknown } }).inlineData?.data;

/**
 * 从请求里还原「用户原文」。真实模型的输入包在 USER STORY / STORY / Story 段里，
 * mock 必须把它抠出来，否则分页、抽角色就只能返回写死的假话。
 */
function extractStory(ctx: RequestCtx): string {
  const raw = ctx.user;

  const cut = (marker: RegExp): string | null => {
    const m = marker.exec(raw);
    if (!m) return null;
    const tail = raw.slice((m.index ?? 0) + m[0].length);
    return tail;
  };

  let candidate =
    cut(/USER STORY:\s*/i) ??
    cut(/STORY:\s*/i) ??
    cut(/Story:\s*/i) ??
    cut(/whether the following text is safe for children\.?\s*/i) ??
    cut(/Rewrite the following text to be SAFE[^\n]*\s*/i) ??
    raw;

  // 安全校验的 prompt 里正文在 TEXT: 之后
  const afterText = /\bTEXT:\s*/.exec(candidate);
  if (afterText) candidate = candidate.slice(afterText.index + afterText[0].length);

  // 去掉抽取指令那类尾缀（它们不属于故事正文）
  candidate = candidate.split(/\n\s*Extract up to/im)[0];
  candidate = candidate.split(/\n\s*Return ONLY JSON/im)[0];

  // 若故事被引号包裹，取引号内最长的一段
  const quoted = candidate.match(/"([^"]{4,})"/g);
  if (quoted && quoted.length) {
    const longest = quoted
      .map((q) => q.slice(1, -1))
      .sort((a, b) => b.length - a.length)[0];
    if (longest.length >= 4) candidate = longest;
  }

  const cleaned = candidate
    .replace(/^\s*"|"\s*$/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  return cleaned || "一个小家伙开始了它的一天。";
}

function extractStyle(ctx: RequestCtx): string {
  const DEFAULT_STYLE = "whimsical, cute, children's picture-book style";
  const m =
    /Global visual & narrative style:\s*([^\n]+)/i.exec(ctx.system) ??
    /style\s+"([^"]+)"/i.exec(ctx.user) ??
    /Tone roughly matches this style:\s*([^\n]+)/i.exec(ctx.system) ??
    /make the tone and imagery match this style:\s*([^\n]+)/i.exec(ctx.system);
  return (m?.[1] ?? DEFAULT_STYLE).trim();
}

function extractPageCount(ctx: RequestCtx): number {
  const m = /EXACTLY\s+(\d+)/i.exec(ctx.system);
  return m ? Math.max(1, Number(m[1])) : 6;
}

/** 改写步骤里声明的目标篇幅：中文按「字」算，英文按「词」算。 */
function targetLength(ctx: RequestCtx): { target: number; cjk: boolean } {
  const pages = /about\s+(\d+)\s+pages/i.exec(ctx.system)?.[1];
  const pageCount = pages ? Number(pages) : extractPageCount(ctx);
  const words = /(?:about |~)?([\d]+)\s*words total/i.exec(ctx.system)?.[1];
  const story = extractStory(ctx);
  const cjk = (story.replace(/[^\u4e00-\u9fa5]/g, "").length / Math.max(1, story.length)) > 0.3;
  if (cjk) return { target: pageCount * 60, cjk };
  return { target: words ? Number(words) : pageCount * 90, cjk };
}

// ============================ 文本切分 ============================

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitClauses(sentence: string): string[] {
  return sentence
    .split(/(?<=[，,、：:—])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 正文实在不够分时使用的过渡句（每页不同，避免整页复制）。 */
const PAD_SENTENCES = [
  "风慢慢停了下来，四周安静得能听见心跳。",
  "它抬起头，看见远处有一点小小的光。",
  "脚下的小路弯弯曲曲，一直通向森林深处。",
  "树叶上的露珠闪了一下，像在打招呼。",
  "它深吸一口气，握紧了手里的东西。",
  "夜色一点点铺开，星星也慢慢亮了起来。",
  "远处的屋顶冒出炊烟，空气里暖暖的。",
  "它回头看了一眼，然后坚定地继续往前走。",
  "路边的小花轻轻摇晃，好像在说加油。",
  "一切都在慢慢变好，故事还在继续。",
];

/** 把故事切成 n 段：先按句，句不够再按逗句，还够不满则二分最长段。 */
function chunkIntoPages(text: string, n: number): string[] {
  let units = splitSentences(text);
  if (units.length < n) {
    const refined: string[] = [];
    for (const u of units) {
      const clauses = splitClauses(u);
      refined.push(...(clauses.length > 1 ? clauses : [u]));
    }
    units = refined;
  }
  if (units.length === 0) {
    return Array.from({ length: n }, (_, i) => `（第 ${i + 1} 页暂无正文）`);
  }
  if (units.length > n) {
    // 按字数均衡地并成 n 段（不再用「复制最后一段」补齐，那会造出两页完全相同的正文）
    const groups: string[][] = Array.from({ length: n }, () => []);
    const total = units.reduce((sum, u) => sum + u.length, 0);
    const per = total / n;
    let gi = 0;
    let acc = 0;
    for (const u of units) {
      // acc 每段都会归零，所以阈值只看 per（乘 gi+1 会让后面几段永远切不动）
      if (gi < n - 1 && acc > 0 && acc >= per) {
        gi += 1;
        acc = 0;
      }
      groups[gi].push(u);
      acc += u.length;
    }
    const out = groups.map((g, i) =>
      g.length ? g.join("") : PAD_SENTENCES[i % PAD_SENTENCES.length]
    );
    return dedupeAdjacent(out);
  }
  // units.length < n：持续二分最长的段
  const out = [...units];
  while (out.length < n) {
    let idx = 0;
    for (let i = 1; i < out.length; i++) {
      if (out[i].length > out[idx].length) idx = i;
    }
    if (out[idx].length < 2) break; // 切不动了，下面用过渡句补齐
    const mid = Math.ceil(out[idx].length / 2);
    const pieces = [out[idx].slice(0, mid), out[idx].slice(mid)].filter(Boolean);
    out.splice(idx, 1, ...pieces);
  }
  while (out.length < n) {
    out.push(PAD_SENTENCES[(out.length - units.length) % PAD_SENTENCES.length]);
  }
  return dedupeAdjacent(out);
}

/** 兜底：相邻两页正文完全相同时，后一页改用过渡句，保证每页可读且不同。 */
function dedupeAdjacent(pages: string[]): string[] {
  return pages.map((text, i) =>
    i > 0 && text === pages[i - 1] ? PAD_SENTENCES[i % PAD_SENTENCES.length] : text
  );
}

// ============================ 角色抽取 ============================

interface LexiconEntry {
  id: string;
  test: RegExp;
  visual: string;
}

// id 必须是 lowercase snake_case：geminiService.slugifyId 会把中文折叠成 "character"，
// 多角色会撞 key，进而导致锚图串角色。
const LEXICON: LexiconEntry[] = [
  { id: "little_cat", test: /猫咪|小猫|橘猫/, visual: "一只圆滚滚的橘色小猫，蓝色眼睛，脖子上系着红色小围巾" },
  { id: "little_dog", test: /小狗|狗狗|小犬/, visual: "一只奶白色的小狗，垂着耳朵，尾巴摇个不停" },
  { id: "little_bear", test: /小熊|狗熊|熊/, visual: "一只圆滚滚的棕色小熊，圆耳朵，穿着蓝色小背心" },
  { id: "little_rabbit", test: /兔子|小兔|邮递员/, visual: "一只雪白的小兔子，长耳朵竖起，背着会发光的布包" },
  { id: "little_fox", test: /狐狸/, visual: "一只橙红色的小狐狸，蓬松的大尾巴，胸口有一撮白毛" },
  { id: "little_elephant", test: /大象/, visual: "一只灰色的小象，长鼻子卷起来，耳朵大大的" },
  { id: "little_bird", test: /小鸟|鸟/, visual: "一只黄色羽毛的小鸟，圆圆的小脑袋" },
  { id: "little_fish", test: /小鱼|鱼儿/, visual: "一条橙色的小鱼，尾巴半透明" },
  { id: "little_girl", test: /小女孩|女孩/, visual: "一个扎着两条辫子的小女孩，穿着黄色小雨衣" },
  { id: "little_boy", test: /小男孩|男孩/, visual: "一个短发的小男孩，戴着蓝色小帽子" },
  { id: "mom", test: /妈妈|母亲/, visual: "一位温柔的妈妈，长发，穿着浅色围裙" },
  { id: "dad", test: /爸爸|父亲/, visual: "一位高高瘦瘦的爸爸，戴着眼镜" },
  { id: "grandpa", test: /爷爷/, visual: "一位白胡子的老爷爷，笑起来眼睛弯弯的" },
  { id: "grandma", test: /奶奶/, visual: "一位银白头发的老奶奶，戴着圆框眼镜" },
  { id: "teacher", test: /老师/, visual: "一位温和的老师，手里总是拿着一本书" },
];

const ENGLISH_STOPWORDS = new Set([
  "Story", "Page", "Once", "There", "This", "That", "They", "Then", "When", "The", "And",
  "But", "Because", "However", "Finally", "Suddenly", "Every", "Some", "One", "It",
]);

function extractCharactersFromStory(story: string): ExtractedCharacter[] {
  const hits: { id: string; name: string; visual: string; weight: number; at: number }[] = [];

  for (const entry of LEXICON) {
    const m = entry.test.exec(story);
    if (m) {
      hits.push({
        id: entry.id,
        name: m[0],
        visual: entry.visual,
        weight: m[0].length,
        at: m.index,
      });
    }
  }

  // 英文/拼音人名：连续首字母大写的词
  for (const m of story.matchAll(/\b([A-Z][a-zA-Z]{2,})\b/g)) {
    const word = m[1];
    if (ENGLISH_STOPWORDS.has(word)) continue;
    const at = m.index ?? 0;
    if (hits.some((h) => h.id === word.toLowerCase())) continue;
    hits.push({
      id: word.toLowerCase(),
      name: word,
      visual: `故事里的角色 ${word}，外形特征在文中保持一致`,
      weight: word.length,
      at,
    });
  }

  const seen = new Set<string>();
  const picked = hits
    .sort((a, b) => b.weight - a.weight || a.at - b.at)
    .filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
    .slice(0, 5);

  if (!picked.length) {
    return [
      {
        id: "main_character",
        name: "主角",
        visualDescription: "故事里出现的主要角色，外形特征在每一页保持一致",
      },
    ];
  }

  return picked.map((h) => ({
    id: h.id,
    name: h.name,
    visualDescription: h.visual,
  }));
}

interface ExtractedCharacter {
  id: string;
  name: string;
  visualDescription: string;
}

// ============================ Director 评分 ============================

function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 是否是「重画」轮：pipeline 在重试时会往 prompt 里追加 FIX / SAFETY REPAIR 指令。 */
function isRepairAttempt(ctx: RequestCtx): boolean {
  return /FIX \(based on director\)|SAFETY REPAIR|Be more literal and accurate/.test(
    ctx.user
  );
}

const FRAME_ISSUES = [
  "画面构图偏满，主体没有完全呈现",
  "背景元素过多，视线焦点不够集中",
  "角色动作与文字描述的幅度不完全一致",
];

const IDENTITY_ISSUES = [
  "角色毛色与参考图略有偏差",
  "配饰细节与角色表不完全一致",
  "角色体型比参考图稍胖",
];

/**
 * 评分：随「被评估图片 + 文本」确定性抖动。
 * - 首轮：0.72–0.99，偶尔低于 0.75 阈值（真实模型也常给出待修分数）；
 * - 修复轮（prompt 带 FIX/SAFETY REPAIR）：0.90–0.99，用于验证重试与候选排序。
 */
function scoreFor(ctx: RequestCtx): { score: number; issues: string[]; pool: string[] } {
  // 参与打分的必须是「全部图片 + 文本」。图片要取首/中/尾三段采样：
  // 同一角色、同一尺寸的 PNG 头部完全一样，只取前缀会让不同页得到同一个分数。
  const key =
    ctx.images
      .map((i) => {
        const d = i.data;
        const mid = Math.floor(d.length / 2);
        return d.slice(0, 32) + d.slice(mid, mid + 32) + d.slice(-32);
      })
      .join("|") +
    ctx.user.slice(0, 200);
  const noise = (hash32(key) % 1000) / 1000;
  if (isRepairAttempt(ctx)) {
    return { score: Number((0.9 + noise * 0.09).toFixed(3)), issues: [], pool: [] };
  }
  const score = Number((0.72 + noise * 0.27).toFixed(3));
  const pool = /identity|consistent/i.test(ctx.system) ? IDENTITY_ISSUES : FRAME_ISSUES;
  if (score >= 0.9) return { score, issues: [], pool };
  return { score, issues: [pool[hash32(key) % pool.length]], pool };
}

// ============================ 按 schema 补全 ============================

const typeOf = (node: any): string => String(node?.type ?? "").toUpperCase();

/** 未显式处理的字段按类型兜底，保证新 schema 也不会缺字段。 */
function genericFill(node: any, ctx: RequestCtx, key: string): any {
  if (!node || typeof node !== "object") return null;
  switch (typeOf(node)) {
    case "OBJECT": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node.properties ?? {})) {
        out[k] = genericFill(v, ctx, k);
      }
      return out;
    }
    case "ARRAY": {
      const items = node.items;
      if (items && typeOf(items) === "OBJECT") return [genericFill(items, ctx, key)];
      return [];
    }
    case "STRING":
      return stringFor(key, ctx);
    case "NUMBER":
    case "INTEGER":
      return numberFor(key);
    case "BOOLEAN":
      return true;
    default:
      return null;
  }
}

function stringFor(key: string, ctx: RequestCtx): string {
  const k = key.toLowerCase();
  if (k.includes("prompt")) return buildImagePrompt(extractStory(ctx), extractStyle(ctx), 1);
  if (k.includes("feedback")) return "故事整体清晰，仅做了轻微润色。";
  if (k.includes("story")) return extractStory(ctx);
  if (k.includes("name")) return "主角";
  if (k.includes("id")) return "main_character";
  if (k.includes("description")) return "角色外形特征在每一页保持一致";
  const summary = extractStory(ctx).replace(/\s+/g, " ").slice(0, 24);
  return summary || "mock";
}

function numberFor(key: string): number {
  const k = key.toLowerCase();
  if (k.includes("pagenumber") || k.includes("pages") || k.includes("index")) return 1;
  if (k.includes("score") || k.includes("threshold") || k.includes("count")) return 1;
  return 0;
}

function buildImagePrompt(scene: string, style: string, index: number): string {
  const excerpt = scene.replace(/\s+/g, " ");
  const clipped = excerpt.length > 36 ? `${excerpt.slice(0, 36)}…` : excerpt;
  return (
    `Children's picture-book illustration (page ${index}). ` +
    `Scene: ${clipped} ` +
    `Style: ${style}. ` +
    `Keep the main character identical to the reference sheets, soft lighting, full-bleed composition, no text overlay.`
  );
}

// ============================ 各调用点的专用返回 ============================

function buildPagesValue(ctx: RequestCtx) {
  const n = extractPageCount(ctx);
  const story = extractStory(ctx);
  const style = extractStyle(ctx);
  const chunks = chunkIntoPages(story, n);
  return chunks.map((text, i) => ({
    pageNumber: i + 1,
    text,
    imagePrompt: buildImagePrompt(text, style, i + 1),
  }));
}

function buildRefineValue(ctx: RequestCtx) {
  const story = extractStory(ctx);
  const { target, cjk } = targetLength(ctx);
  const normalized = story.replace(/\s+/g, " ").trim();
  const measure = (s: string): number =>
    cjk ? s.replace(/[^\u4e00-\u9fa5]/g, "").length : s.split(/\s+/).filter(Boolean).length;

  if (measure(normalized) >= target * 0.7) {
    return {
      mode: "good_polish" as const,
      feedback:
        "故事结构完整、人物清晰，只做了轻微润色：修正了拗口的句子，并统一了叙述节奏。",
      finalStory: normalized,
    };
  }

  // 原稿偏短：模拟真实模型按目标篇幅扩写（补过程细节与环境描写，不改主线）
  const fillers = [
    "它慢慢地走过小路，看见了好多有趣的东西。",
    "风轻轻吹过，树叶沙沙地响成一片。",
    "一路上，它遇到了几个热情的新朋友。",
    "天空渐渐变了颜色，影子也被拉得长长的。",
    "它停下来想了想，然后有了新主意。",
    "远处的屋顶冒出细细的炊烟，空气里暖暖的。",
    "小草上挂着露珠，踩上去软软的。",
    "它忍不住笑了起来，脚步也轻快了。",
    "天色一点点暗下来，第一颗星星悄悄亮了。",
    "最后，它带着满满的好心情回家了。",
  ];
  // 每句只用一次：循环复用会造出重复句，进而让两页正文完全一样。
  let expanded = normalized;
  for (const sentence of fillers) {
    if (measure(expanded) >= target * 0.9) break;
    expanded += sentence;
  }
  return {
    mode: "rewrite" as const,
    feedback:
      "原稿篇幅不足以铺满目标页数，已在不改变主线的前提下扩写：补充了过程细节与环境描写。",
    finalStory: expanded,
  };
}

function buildSafetyValue(ctx: RequestCtx, props: Record<string, any>) {
  const story = extractStory(ctx);
  const out: Record<string, unknown> = { isSafe: true, reasons: [] as string[] };
  if (props.sanitizedText) {
    out.sanitizedText = story;
    out.reasons = ["已按儿童友好标准复核，无需改动。"];
  }
  return out;
}

let sequenceCalls = 0;

function buildJudgeValue(ctx: RequestCtx, props: Record<string, any>) {
  const { score, issues, pool } = scoreFor(ctx);

  // 序列 Director：首次给出略低于阈值的分数 + 待修页码，
  // 用来触发 generationService 的「全局修复」分支（第二轮即通过）。
  if (props.problemPages) {
    sequenceCalls += 1;
    const pageNumbers = Array.from(ctx.user.matchAll(/PAGE\s+(\d+)\s+TEXT/g)).map((m) =>
      Number(m[1])
    );
    if (sequenceCalls % 2 === 1) {
      const target = pageNumbers.length > 1 ? pageNumbers[1] : pageNumbers[0] ?? 1;
      return {
        isConsistent: false,
        score: 0.78,
        issues: ["相邻页之间主角的主色略有漂移，建议重画受影响的一页。"],
        problemPages: [target],
      };
    }
    return {
      isConsistent: true,
      score: 0.92,
      issues: [] as string[],
      problemPages: [] as number[],
    };
  }

  const out: Record<string, unknown> = {};
  if (props.isAcceptable) out.isAcceptable = score >= 0.75;
  if (props.isConsistent) out.isConsistent = score >= 0.75;
  if (props.isSafe) out.isSafe = true;
  out.score = score;
  if (props.issues) out.issues = issues;
  if (props.reasons) out.reasons = [] as string[];
  void pool;
  return out;
}

// ============================ 后端实现 ============================

export function createMockBackend(): ModelBackend {
  return {
    id: "mock",
    label: "Mock (local, no API)",
    maxRefs: 14,
    supportsVision: true,

    async generateJSON(args: GenerateJSONArgs): Promise<any> {
      const ctx = readCtx(args);
      const props = ((args.schema as any)?.properties ?? {}) as Record<string, any>;

      const generic = genericFill(args.schema, ctx, "root") ?? {};
      let explicit: Record<string, unknown> | null = null;

      if (props.characters) {
        explicit = { characters: extractCharactersFromStory(extractStory(ctx)) };
      } else if (props.pages) {
        explicit = { pages: buildPagesValue(ctx) };
      } else if (props.finalStory) {
        explicit = buildRefineValue(ctx);
      } else if (props.isSafe || props.sanitizedText) {
        explicit = buildSafetyValue(ctx, props);
      } else if (props.isAcceptable || props.isConsistent || props.score) {
        explicit = buildJudgeValue(ctx, props);
      }

      return explicit ? { ...generic, ...explicit } : generic;
    },

    async generateImage(args: GenerateImageArgs): Promise<string> {
      return paintMockImage({
        prompt: args.prompt,
        aspectRatio: args.aspectRatio,
        imageSize: args.imageSize,
        referenceDataUrls: args.referenceDataUrls,
      });
    },
  };
}
