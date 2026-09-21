// Mock 多模型后端：零真实 API 调用，返回 schema 感知的假数据，
// 使整条绘本流水线（抽角色 → 改写/分页 → 逐页生图 → Director 校验 → 序列评分）
// 在无真实大模型下也能产出合法、可落库的结果。
//
// 仅用于测试。绝不包含任何真实 API Key 或网络请求。

import type { ModelBackend, GenerateJSONArgs, GenerateImageArgs } from "./types";

// 1×1 透明 PNG 的 base64（合法最小图片，供生图 / 锚图 / 页图落库）。
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function pageCountFromSystemInstruction(args: GenerateJSONArgs): number {
  const si = args.systemInstruction || "";
  const m = /EXACTLY\s+(\d+)/i.exec(si);
  return m ? Number(m[1]) : 6;
}

export function createMockBackend(): ModelBackend {
  return {
    id: "mock",
    label: "Mock (no real API)",
    maxRefs: 14,
    supportsVision: true,

    async generateJSON(args: GenerateJSONArgs): Promise<any> {
      const props = (args.schema as any)?.properties || {};

      // 1) 抽角色
      if (props.characters) {
        return {
          characters: [
            {
              id: "main_character",
              name: "主角",
              visualDescription: "一只圆滚滚的小橘猫，蓝色眼睛，系着红围巾",
            },
          ],
        };
      }

      // 2) 分页（页数从 systemInstruction 的 "EXACTLY N" 解析）
      if (props.pages) {
        const n = pageCountFromSystemInstruction(args);
        return {
          pages: Array.from({ length: n }, (_, i) => ({
            pageNumber: i + 1,
            text: `第 ${i + 1} 页示例文字`,
            imagePrompt: `示例画面描述 ${i + 1}`,
          })),
        };
      }

      // 3) 改写（refine）：返回合法 finalStory（下游分页不依赖其真实内容）
      if (props.finalStory) {
        return {
          mode: "good_polish",
          feedback: "mock: 直接采用原文",
          finalStory:
            "从前有一只小熊，它在森林里开始了奇妙的一天，遇到了许多好朋友。",
        };
      }

      // 4) 任何评分 / 安全 schema（frame / identity / sequence / safety）：一律通过
      if (props.isAcceptable || props.isConsistent || props.isSafe) {
        return {
          isAcceptable: true,
          isConsistent: true,
          isSafe: true,
          score: 1,
          issues: [],
          problemPages: [],
        };
      }

      return {};
    },

    async generateImage(_args: GenerateImageArgs): Promise<string> {
      return PNG_DATA_URL;
    },
  };
}
