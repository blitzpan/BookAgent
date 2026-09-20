// services/geminiService.ts
//
// 多模型改造后的"编排层"：保留原有全部导出函数签名，内部按角色（TEXT/IMAGE/VISION）
// 选择对应的 ModelBackend（见 ./providers）。默认全 gemini，行为与原实现 100% 一致。
//
// 拆分分析（详见仓库 MULTI_MODEL.md）：
//   - 文本生成（extractCharacters / refine / parse / safetyCheckText）     -> TEXT 角色
//   - 图像生成（generateImage）                                            -> IMAGE 角色
//   - 视觉校验（三个 Director + safetyCheckImage，需要看图）               -> VISION 角色
// 三类彼此独立，可分别指定不同 provider；一致性由 L1 文本锁 + L2 多参考图 + L4 校验闭环保证，
// 与具体厂商无关，故拆分不影响一致性核心。

import { Type } from "@google/genai";
import type { StoryPage } from "../types";
import { getTextBackend, getImageBackend, getVisionBackend } from "./providers";
import { fileToGenerativePart, dataUrlToInlineImagePart } from "./providers/util";
import type { Part } from "./providers/types";

// ============ 0. Character Definition (for consistency) ============
export interface ExtractedCharacter {
  /** Stable id used to select reference images. */
  id: string;
  /** Display name (may appear in the story). */
  name: string;
  /** Visual description used to generate character sheets (species, colors, clothing, notable features). */
  visualDescription: string;
}

const slugifyId = (name: string) => {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "character";
};

export const extractCharacters = async (
  story: string,
  style: string
): Promise<ExtractedCharacter[]> => {
  try {
    const systemInstruction = `You extract ALL RECURRING characters from a children's picture-book story for illustration consistency.
Return up to FIVE recurring characters (max 5). If there are more, merge or omit minor one-off characters.
For each character, return:
- id: short stable id (lowercase snake_case)
- name: the name (or a short label like "the puppy" if unnamed)
- visualDescription: concise but specific visual details (species, fur/skin color, clothing, notable features, and any distinctive recurring props/symbols like a star on a bag).
Style context: ${style}

Return ONLY JSON that matches the schema.`;

    const userPrompt = `STORY:\n${story}\n\nExtract up to 5 recurring characters (max 5). Prefer characters that persist across multiple pages.`;

    const json = await getTextBackend().generateJSON({
      systemInstruction,
      parts: [{ text: userPrompt }],
      schema: {
        type: Type.OBJECT,
        properties: {
          characters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                visualDescription: { type: Type.STRING },
              },
              required: ["id", "name", "visualDescription"],
            },
          },
        },
        required: ["characters"],
      },
      role: "text",
    });

    const chars = Array.isArray(json.characters) ? json.characters : [];

    const cleaned: ExtractedCharacter[] = chars
      .map((c: any) => ({
        id: String(c.id || ""),
        name: String(c.name || ""),
        visualDescription: String(c.visualDescription || ""),
      }))
      .filter((c) => c.name.trim().length > 0 || c.visualDescription.trim().length > 0)
      .map((c) => ({
        ...c,
        id: c.id.trim() ? slugifyId(c.id) : slugifyId(c.name),
        name: c.name.trim() ? c.name : "Main character",
        visualDescription: c.visualDescription.trim() ? c.visualDescription : c.name,
      }))
      .slice(0, 5);

    return cleaned;
  } catch (error) {
    console.error("Error extracting characters:", error);
    return [];
  }
};

// ============ 1. Reviewer + Refiner ============

export const refineStoryForPageCount = async (
  story: string,
  targetPageCount: number,
  style: string
): Promise<{
  finalStory: string;
  mode: "good_polish" | "rewrite";
  feedback: string;
}> => {
  try {
    const safePageCount = Math.min(Math.max(targetPageCount, 1), 20);

    const approxWordsPerPage = 90;
    const targetTotalWords = approxWordsPerPage * safePageCount;

    const systemInstruction = `You are an assistant that first REVIEWS and then REFINES children's stories for picture books.

Your job has TWO phases:

1) REVIEW:
- Read the user's story.
- Judge if it is already reasonably good for about ${safePageCount} pages in a picture book.
- "Reasonably good" means:
  - Clear beginning, middle, and end.
  - Main character(s) and goal are understandable.
  - Tone roughly matches this style: ${style}.
  - Story length is roughly appropriate for ~${targetTotalWords} words total (it can be shorter or longer, but not extreme).

2) REFINE:
There are TWO possible refine modes:

A) If the story is ALREADY reasonably good:
   - Set "mode" = "good_polish".
   - Apply ONLY light editing:
     - Fix grammar and awkward phrases.
     - Improve clarity and flow at the sentence level.
     - Add very small details if helpful, but DO NOT change the overall structure or main events.
   - The refined story should still clearly feel like the same story from the user, just smoother and slightly better.
   - Length should remain roughly similar, only slightly adjusted to better fit ~${targetTotalWords} words.

B) If the story is NOT good enough (too short, too long, very unclear, or poorly structured):
   - Set "mode" = "rewrite".
   - Do a stronger rewrite:
     - Expand the story with richer but still simple details if it is too short.
     - Compress and remove repetition or irrelevant digressions if it is too long.
     - Improve clarity, structure, and pacing, while keeping the user's main characters, tone, and core plot.
   - Aim for about ${targetTotalWords} words total (approximate, not exact).
   - Make the tone and imagery match this style: ${style}.

IMPORTANT:
- The refined story MUST have at most 5 recurring characters total. If the draft has more, merge minor characters into existing ones or remove them.
- Keep character names and appearances stable throughout the story (no swapping species, colors, or clothing).
- Always fill all three fields: "mode", "feedback", and "finalStory".
- "feedback" should briefly explain your decision, e.g., "Story is already clear, did light polishing." or "Too short for the requested length, expanded the middle part."
- Return ONLY JSON that matches the response schema. Do NOT include any extra commentary.`;

    const userPrompt = `Here is the user's draft story. First REVIEW it. 
If it is already reasonably good, do LIGHT POLISHING ("good_polish"). 
If not, REWRITE it more strongly ("rewrite") as described.

USER STORY:
"${story}"`;

    const json = await getTextBackend().generateJSON({
      systemInstruction,
      parts: [{ text: userPrompt }],
      schema: {
        type: Type.OBJECT,
        properties: {
          mode: {
            type: Type.STRING,
            description:
              '"good_polish" if the story was already good and only lightly edited; "rewrite" if a stronger rewrite was done.',
          },
          feedback: {
            type: Type.STRING,
            description:
              "Short natural language feedback explaining the decision and what was changed.",
          },
          finalStory: {
            type: Type.STRING,
            description:
              "The refined story text that should be used for later page splitting.",
          },
        },
        required: ["mode", "feedback", "finalStory"],
      },
      role: "text",
    });

    const mode: "good_polish" | "rewrite" =
      json.mode === "rewrite" ? "rewrite" : "good_polish";

    return {
      mode,
      feedback: String(json.feedback ?? ""),
      finalStory: String(json.finalStory ?? story),
    };
  } catch (error) {
    console.error("Error refining story:", error);
    return {
      mode: "good_polish",
      feedback: "Refine step failed, using original story.",
      finalStory: story,
    };
  }
};

// ============ 2. Script Writer：按页数 + 风格切成 pages ============

export const parseStoryIntoPages = async (
  story: string,
  imageFile: File | null,
  targetPageCount: number = 6,
  style: string = "whimsical, cute, children's picture-book style"
): Promise<Omit<StoryPage, "imageUrl">[]> => {
  try {
    const safePageCount = Math.min(Math.max(targetPageCount, 1), 20);

    const systemInstruction = `You are a creative assistant that helps users turn stories into beautifully illustrated cartoon storybooks for children. 

Your task is to break down a given story into EXACTLY ${safePageCount} logical pages.
For each page, you must provide:
- "pageNumber": starting from 1
- "text": the text portion for that page
- "imagePrompt": a detailed, imaginative prompt for an image generator.

STYLE & CONSISTENCY REQUIREMENTS:
- Global visual & narrative style: ${style}
- Use this style consistently across ALL pages.
- Keep characters' appearance, names, species, clothing, and personality consistent.
- Keep important props, environments, and color palettes consistent, unless the story explicitly changes them.
- Each imagePrompt should clearly reference the same main character(s) so an image model can keep them visually consistent.
- Make sure every page is visually depictable: there should be a clear scene, setting, and character actions.

Return ONLY valid JSON that matches the provided response schema. Do NOT include any extra commentary.`;

    const textPrompt = imageFile
      ? `Analyze the character and style from the provided image. Then, using that as inspiration and following the style "${style}", read the following story and split it into EXACTLY ${safePageCount} pages: "${story}".`
      : `Here is the story. Split it into EXACTLY ${safePageCount} pages.
For each page, output pageNumber, text, and imagePrompt in the style "${style}". Story:
"${story}".`;

    const parts: Part[] = [{ text: textPrompt }];

    if (imageFile) {
      const imagePart = await fileToGenerativePart(imageFile);
      parts.unshift(imagePart as Part);
    }

    const jsonResponse = await getTextBackend().generateJSON({
      systemInstruction,
      parts,
      schema: {
        type: Type.OBJECT,
        properties: {
          pages: {
            type: Type.ARRAY,
            description: `An array of story pages, exactly ${safePageCount} pages long.`,
            items: {
              type: Type.OBJECT,
              properties: {
                pageNumber: {
                  type: Type.INTEGER,
                  description:
                    "The sequential page number, starting from 1.",
                },
                text: {
                  type: Type.STRING,
                  description:
                    "The segment of the story for this specific page.",
                },
                imagePrompt: {
                  type: Type.STRING,
                  description:
                    "A detailed prompt for an image generation AI, in the chosen cartoon style.",
                },
              },
              required: ["pageNumber", "text", "imagePrompt"],
            },
          },
        },
        required: ["pages"],
      },
      role: "text",
    });

    if (!jsonResponse.pages || !Array.isArray(jsonResponse.pages)) {
      throw new Error("Invalid response format from story parsing API.");
    }

    return jsonResponse.pages as Omit<StoryPage, "imageUrl">[];
  } catch (error) {
    console.error("Error parsing story:", error);
    throw new Error(
      "Failed to parse the story into pages. Please try again."
    );
  }
};

// ============ 3. 两个 Director（多模态监制）============

export interface DirectorFrameResult {
  pageNumber: number;
  isAcceptable: boolean;
  score: number;
  issues: string[];
}

export interface DirectorSequenceResult {
  isConsistent: boolean;
  score: number;
  issues: string[];
  /** Optional list of page numbers that most likely need repair. */
  problemPages?: number[];
}

export interface DirectorIdentityResult {
  /** Whether the generated image preserves identity w.r.t. the provided reference sheets. */
  isConsistent: boolean;
  /** 0.0–1.0 overall identity consistency score. */
  score: number;
  /** Short issues describing mismatched identities/props/style. */
  issues: string[];
}

export const directorCheckFrame = async (
  page: StoryPage
): Promise<DirectorFrameResult> => {
  if (!page.imageUrl) {
    return {
      pageNumber: page.pageNumber,
      isAcceptable: false,
      score: 0,
      issues: ["No image available for this page."],
    };
  }

  try {
    const imagePart = dataUrlToInlineImagePart(page.imageUrl);
    const userText = `You are the FRAME DIRECTOR for a children's picture-book production.

Your job is to evaluate ONE page (one image + its text):

PAGE NUMBER: ${page.pageNumber}

TEXT:
"${page.text}"

Please check:
1. Does the image match the main events, characters, and mood described in the text?
2. Are the important objects, characters, and setting correctly reflected?
3. Would this image feel "correct" to a child reading this text?

Scoring:
- "score" is a number between 0.0 and 1.0.
- score >= 0.75: acceptable.
- score < 0.75: not acceptable.

Return ONLY JSON with:
- "isAcceptable": boolean
- "score": number
- "issues": array of short strings (empty if acceptable).`;

    const json = await getVisionBackend().generateJSON({
      parts: [imagePart as Part, { text: userText }],
      schema: {
        type: Type.OBJECT,
        properties: {
          isAcceptable: { type: Type.BOOLEAN },
          score: { type: Type.NUMBER },
          issues: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["isAcceptable", "score", "issues"],
      },
      role: "vision",
    });

    return {
      pageNumber: page.pageNumber,
      isAcceptable: Boolean(json.isAcceptable),
      score: Number(json.score ?? 0),
      issues: Array.isArray(json.issues)
        ? json.issues.map((x: unknown) => String(x))
        : [],
    };
  } catch (error) {
    console.error("Error in directorCheckFrame:", error);
    return {
      pageNumber: page.pageNumber,
      isAcceptable: true,
      score: 1,
      issues: ["Director frame check failed, treating as acceptable."],
    };
  }
};

export const directorCheckIdentity = async (
  args: {
    pageNumber: number;
    pageText: string;
    generatedImageUrl: string;
    /** Reference sheets for all recurring characters (recommended: <=5). */
    characterSheets: { name: string; visualDescription: string; dataUrl: string }[];
    /** Optional group sheet showing all characters together. */
    groupSheetDataUrl?: string | null;
    /** Optional global style. */
    style?: string;
  }
): Promise<DirectorIdentityResult> => {
  try {
    const parts: Part[] = [];

    parts.push({
      text:
        `You are the IDENTITY DIRECTOR for a children's picture-book production.\n` +
        `Your job is to check whether the GENERATED PAGE IMAGE preserves character identity and key recurring props\n` +
        `with respect to the provided REFERENCE SHEETS.\n\n` +
        `RULES:\n` +
        `- Treat reference sheets as GROUND TRUTH for character appearance (species, fur/skin color, markings, clothing, face shape).\n` +
        `- If the page text conflicts with the reference sheets about appearance, the reference sheets win.\n` +
        `- Score should penalize: color/marking drift, species drift, missing/extra main characters, major prop drift.\n` +
        `- Ignore small pose changes; focus on identity and recurring attributes.\n\n` +
        `- Output issues ordered from MOST identity-critical to least (e.g., wrong species/fur/markings/clothing, missing distinctive symbols like a star on a bag, hood vs collar).\n\n` +
        `PAGE ${args.pageNumber} TEXT:\n"${args.pageText}"\n\n` +
        (args.style ? `GLOBAL STYLE: ${args.style}\n\n` : ``) +
        `Now you will be shown the reference sheets, then the generated page image.`,
    });

    // Reference sheets
    for (const ch of (args.characterSheets || []).slice(0, 5)) {
      if (!ch?.dataUrl) continue;
      parts.push({
        text: `REFERENCE SHEET — ${ch.name}\nExpected visual traits: ${ch.visualDescription}\nImage:`,
      });
      parts.push(dataUrlToInlineImagePart(ch.dataUrl) as Part);
    }

    if (args.groupSheetDataUrl) {
      parts.push({ text: `REFERENCE GROUP SHEET (all characters together):` });
      parts.push(dataUrlToInlineImagePart(args.groupSheetDataUrl) as Part);
    }

    // Generated image
    parts.push({ text: `GENERATED PAGE IMAGE (evaluate identity vs references):` });
    parts.push(dataUrlToInlineImagePart(args.generatedImageUrl) as Part);

    const json = await getVisionBackend().generateJSON({
      parts,
      schema: {
        type: Type.OBJECT,
        properties: {
          isConsistent: { type: Type.BOOLEAN },
          score: { type: Type.NUMBER },
          issues: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["isConsistent", "score", "issues"],
      },
      role: "vision",
    });

    return {
      isConsistent: Boolean(json.isConsistent),
      score: Number(json.score ?? 0),
      issues: Array.isArray(json.issues)
        ? json.issues.map((x: unknown) => String(x))
        : [],
    };
  } catch (error) {
    console.error("Error in directorCheckIdentity:", error);
    // Fail-open: don't block generation if identity director fails
    return {
      isConsistent: true,
      score: 1,
      issues: ["Identity director check failed; treating as consistent."],
    };
  }
};

export const directorCheckSequence = async (
  pages: StoryPage[],
  style: string
): Promise<DirectorSequenceResult> => {
  try {
    const parts: Part[] = [];

    for (const page of pages) {
      if (!page.imageUrl) continue;
      parts.push({
        text: `PAGE ${page.pageNumber} TEXT:\n"${page.text}"\nNow see its image:`,
      });
      parts.push(dataUrlToInlineImagePart(page.imageUrl) as Part);
    }

    const systemInstruction = `You are the SEQUENCE DIRECTOR for a children's picture-book production.

You will see a sequence of pages (each with text and an image).
Evaluate the WHOLE SEQUENCE with respect to:

1. Character continuity:
   - Do the main characters look like the same entities across pages?
   - Are species, approximate age, main clothing / colors, and notable features consistent?

2. World & prop continuity:
   - Are important recurring locations, objects, or props consistent across pages
     (unless the story clearly changes them)?

3. Global style:
   - Does the art style look coherent across pages (line quality, color palette, level of detail)?

4. Narrative alignment:
   - Does the progression of images roughly follow the text from early pages to later pages?

Scoring:
- "score" is a number between 0.0 and 1.0 for overall sequence quality.
- score >= 0.75: "isConsistent" = true.
- score < 0.75: "isConsistent" = false.

Return ONLY JSON with:
- "isConsistent": boolean
- "score": number
- "issues": array of short strings describing the main continuity problems (empty if consistent).
- "problemPages": array of page numbers that most likely need repair (empty if consistent).`;

    const json = await getVisionBackend().generateJSON({
      systemInstruction,
      parts: [
        {
          text: `Global target style (for reference): ${style}\n\nNow evaluate the following sequence of pages:`,
        },
        ...parts,
      ],
      schema: {
        type: Type.OBJECT,
        properties: {
          isConsistent: { type: Type.BOOLEAN },
          score: { type: Type.NUMBER },
          issues: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          problemPages: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description:
              "Page numbers that most likely need repair for consistency (use existing page numbers).",
          },
        },
        required: ["isConsistent", "score", "issues"],
      },
      role: "vision",
    });

    return {
      isConsistent: Boolean(json.isConsistent),
      score: Number(json.score ?? 0),
      issues: Array.isArray(json.issues)
        ? json.issues.map((x: unknown) => String(x))
        : [],
      problemPages: Array.isArray(json.problemPages)
        ? json.problemPages
            .map((x: unknown) => Number(x))
            .filter((n: number) => Number.isFinite(n) && n > 0)
        : [],
    };
  } catch (error) {
    console.error("Error in directorCheckSequence:", error);
    return {
      isConsistent: true,
      score: 1,
      issues: ["Director sequence check failed, treating as consistent."],
      problemPages: [],
    };
  }
};

// ============ 3.5 Safety (children-friendly content checks) ============

export interface SafetyTextResult {
  isSafe: boolean;
  reasons: string[];
  sanitizedText?: string;
}

export interface SafetyImageResult {
  isSafe: boolean;
  reasons: string[];
}

export const safetyCheckText = async (
  input: string,
  mode: "check" | "sanitize" = "check"
): Promise<SafetyTextResult> => {
  try {
    const systemInstruction = `You are a strict safety checker for CHILDREN'S storybooks.
Flag and reject any: sexual content, nudity, erotic/suggestive themes, sexualization of minors, adult romance themes.
Also flag: graphic violence/gore, hate/harassment, instructions for wrongdoing.
Return ONLY JSON.`;

    const userText =
      mode === "check"
        ? `Check whether the following text is safe for children.
If unsafe, set isSafe=false and list brief reasons.

TEXT:\n${input}`
        : `Rewrite the following text to be SAFE for children while keeping the plot as much as possible.
Remove/replace unsafe content. Output sanitizedText.

TEXT:\n${input}`;

    const json = await getTextBackend().generateJSON({
      systemInstruction,
      parts: [{ text: userText }],
      schema: {
        type: Type.OBJECT,
        properties: {
          isSafe: { type: Type.BOOLEAN },
          reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
          sanitizedText: { type: Type.STRING },
        },
        required: ["isSafe", "reasons"],
      },
      role: "text",
    });

    return {
      isSafe: Boolean(json.isSafe),
      reasons: Array.isArray(json.reasons)
        ? json.reasons.map((x: unknown) => String(x))
        : [],
      sanitizedText:
        typeof json.sanitizedText === "string" ? json.sanitizedText : undefined,
    };
  } catch (error) {
    console.error("Error in safetyCheckText:", error);
    // Fail-open to avoid blocking (your UI will still have image-level checks)
    return { isSafe: true, reasons: ["Safety text check failed; treating as safe."] };
  }
};

export const safetyCheckImage = async (
  imageDataUrl: string
): Promise<SafetyImageResult> => {
  try {
    const systemInstruction = `You are a strict safety checker for CHILDREN'S illustrations.
Flag and reject any: nudity, sexual content, suggestive depiction, sexualization of minors, adult/erotic themes.
Also flag: graphic violence/gore, hate symbols.
Return ONLY JSON.`;

    const imagePart = dataUrlToInlineImagePart(imageDataUrl);

    const json = await getVisionBackend().generateJSON({
      systemInstruction,
      parts: [imagePart as Part, { text: "Is this image safe for children? Return JSON." }],
      schema: {
        type: Type.OBJECT,
        properties: {
          isSafe: { type: Type.BOOLEAN },
          reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["isSafe", "reasons"],
      },
      role: "vision",
    });

    return {
      isSafe: Boolean(json.isSafe),
      reasons: Array.isArray(json.reasons)
        ? json.reasons.map((x: unknown) => String(x))
        : [],
    };
  } catch (error) {
    console.error("Error in safetyCheckImage:", error);
    return { isSafe: true, reasons: ["Safety image check failed; treating as safe."] };
  }
};

// ============ 4. 图片生成（多参考图，可插拔后端）============

export const generateImage = async (
  prompt: string,
  referenceDataUrls: string[] = []
): Promise<string> => {
  // 约定（一致性相关）：referenceDataUrls[0] 为风格参考，[1..] 为角色锚图。
  // 具体如何把参考图喂给模型、以及 REFERENCE ROLES prompt 的组装，由各后端实现。
  const backend = getImageBackend();
  const capped = (referenceDataUrls || [])
    .filter(Boolean)
    .slice(0, backend.maxRefs);

  return backend.generateImage({
    prompt,
    referenceDataUrls: capped,
    aspectRatio: "4:3",
    imageSize: "2K",
  });
};
