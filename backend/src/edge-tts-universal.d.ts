// edge-tts-universal@1.4.0 的 package.json 将 types 指向 dist/index.d.ts，
// 但发布包里只有 dist/index.d.cts，ESM/Bundler 解析下 TS 找不到声明。
// 这里按包自带 index.d.cts 的权威定义，仅补齐本项目实际用到的两个导出；
// 纯类型声明，不影响运行时行为。

declare module "edge-tts-universal" {
  export interface ProsodyOptions {
    rate?: string;
    volume?: string;
    pitch?: string;
  }

  export interface WordBoundary {
    offset: number;
    duration: number;
    text: string;
  }

  export interface SynthesisResult {
    audio: Blob;
    subtitle: WordBoundary[];
  }

  export class EdgeTTS {
    constructor(text: string, voice?: string, options?: ProsodyOptions);
    synthesize(): Promise<SynthesisResult>;
  }

  export interface VoiceTag {
    ContentCategories?: string[];
    VoicePersonalities?: string[];
  }

  export interface Voice {
    Name: string;
    ShortName: string;
    Gender: string;
    Locale: string;
    FriendlyName: string;
    VoiceTag?: VoiceTag;
  }

  export function listVoices(proxy?: string): Promise<Voice[]>;
}
