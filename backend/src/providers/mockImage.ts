// Mock 生图（"简易画图"）：用纯 Node（zlib）在内存里画出一张真正的 PNG。
//
// 为什么不用 1×1 占位图：1×1 图会让所有候选图长得一模一样，Director 排序、
// 候选图对比、阅读端翻页这些 UI 分支根本验不出来。这里按 prompt / 参考图
// 生成确定性的画面（同一 prompt 永远得到同一张图），具备：
//   - 天空渐变 + 太阳/月亮 + 云 + 远近山丘 + 地面；
//   - 角色剪影：数量与配色由参考图（角色锚图）决定，因此同一角色跨页外观稳定；
//   - CHARACTER SHEET（锚图）提示画单人大图 + 中性背景；
//   - 宽高比与 imageSize 按请求参数解析。
//
// 无第三方依赖、无网络请求，仅用于 mock。

import zlib from "node:zlib";

type RGB = readonly [number, number, number];

export interface MockImageOptions {
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  /** 参考图 dataURL（锚图），用于让同角色的跨页画面保持一致。 */
  referenceDataUrls?: string[];
}

// ============================ 基础工具 ============================

function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 由种子得到的确定性 [0,1) 伪随机序列。 */
function seededRandom(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tag = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])), 0);
  return Buffer.concat([len, tag, data, crc]);
}

/** 逐像素绘制为真彩色（RGB）PNG。 */
function encodePng(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => RGB
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      const p = pixelAt(x, y);
      raw[o++] = p[0];
      raw[o++] = p[1];
      raw[o++] = p[2];
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * 安全的取色：`^` / `>>` 得到的是有符号 32 位整数，可能为负，
 * `arr[负数]` 会是 undefined，进而在逐像素绘制时炸掉，故统一走非负取模。
 */
function pick<T>(list: T[], index: number): T {
  const len = list.length;
  return list[((index % len) + len) % len];
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

const shade = (c: RGB, k: number): RGB => [
  Math.max(0, Math.min(255, Math.round(c[0] * k))),
  Math.max(0, Math.min(255, Math.round(c[1] * k))),
  Math.max(0, Math.min(255, Math.round(c[2] * k))),
];

// ============================ 配色 ============================

interface Palette {
  skyTop: RGB;
  skyBottom: RGB;
  hillFar: RGB;
  hillNear: RGB;
  ground: RGB;
  sun: RGB;
}

const PALETTES: Palette[] = [
  {
    skyTop: [255, 214, 170],
    skyBottom: [255, 245, 230],
    hillFar: [196, 206, 160],
    hillNear: [150, 182, 122],
    ground: [198, 164, 116],
    sun: [255, 176, 92],
  }, // 暖阳
  {
    skyTop: [126, 178, 230],
    skyBottom: [222, 240, 250],
    hillFar: [150, 190, 160],
    hillNear: [104, 156, 118],
    ground: [176, 200, 130],
    sun: [255, 236, 156],
  }, // 晴天草地
  {
    skyTop: [62, 72, 140],
    skyBottom: [176, 150, 190],
    hillFar: [70, 76, 128],
    hillNear: [46, 52, 96],
    ground: [58, 48, 82],
    sun: [248, 240, 214],
  }, // 黄昏
  {
    skyTop: [18, 26, 62],
    skyBottom: [58, 82, 142],
    hillFar: [34, 44, 92],
    hillNear: [22, 30, 66],
    ground: [26, 32, 60],
    sun: [246, 248, 255],
  }, // 夜空
  {
    skyTop: [190, 226, 226],
    skyBottom: [240, 250, 246],
    hillFar: [168, 200, 190],
    hillNear: [126, 172, 152],
    ground: [150, 186, 168],
    sun: [255, 244, 210],
  }, // 薄荷
  {
    skyTop: [255, 208, 214],
    skyBottom: [255, 240, 238],
    hillFar: [232, 200, 214],
    hillNear: [212, 168, 190],
    ground: [216, 186, 196],
    sun: [255, 210, 160],
  }, // 粉彩
];

/** 角色固定色板：同一个角色在三张图上都应是同一个颜色。 */
const FIGURE_COLORS: RGB[] = [
  [222, 148, 88],
  [96, 126, 178],
  [232, 198, 112],
  [176, 108, 148],
  [112, 170, 148],
  [226, 152, 152],
];

const CLOTH_COLORS: RGB[] = [
  [206, 88, 78],
  [78, 118, 168],
  [240, 196, 96],
  [122, 158, 116],
  [158, 114, 178],
  [232, 150, 96],
];

// ============================ 构图 ============================

type Shape =
  | { kind: "circle"; cx: number; cy: number; r: number; color: RGB }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; color: RGB }
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: RGB };

function hit(shape: Shape, x: number, y: number): boolean {
  switch (shape.kind) {
    case "circle": {
      const dx = x - shape.cx;
      const dy = y - shape.cy;
      return dx * dx + dy * dy <= shape.r * shape.r;
    }
    case "ellipse": {
      const nx = (x - shape.cx) / shape.rx;
      const ny = (y - shape.cy) / shape.ry;
      return nx * nx + ny * ny <= 1;
    }
    case "rect":
      return (
        x >= shape.x && x < shape.x + shape.w && y >= shape.y && y < shape.y + shape.h
      );
  }
}

/** 一个小人：头 + 身体 + 两条腿，整体以脚底坐标定位。 */
function buildFigure(
  footX: number,
  footY: number,
  unit: number,
  fur: RGB,
  cloth: RGB
): Shape[] {
  const headR = unit * 0.5;
  const bodyRx = unit * 0.52;
  const bodyRy = unit * 0.62;
  return [
    { kind: "rect", x: footX - unit * 0.34, y: footY - unit * 0.42, w: unit * 0.24, h: unit * 0.44, color: fur },
    { kind: "rect", x: footX + unit * 0.1, y: footY - unit * 0.42, w: unit * 0.24, h: unit * 0.44, color: fur },
    { kind: "ellipse", cx: footX, cy: footY - unit * 1.15, rx: bodyRx, ry: bodyRy, color: cloth },
    { kind: "circle", cx: footX, cy: footY - unit * 2.3, r: headR, color: fur },
    { kind: "circle", cx: footX - headR * 0.5, cy: footY - unit * 2.62, r: unit * 0.16, color: fur },
    { kind: "circle", cx: footX + headR * 0.5, cy: footY - unit * 2.62, r: unit * 0.16, color: fur },
  ];
}

function parseAspect(aspectRatio?: string): { rw: number; rh: number } {
  const m = /^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)$/.exec(
    (aspectRatio || "4:3").trim()
  );
  if (!m) return { rw: 4, rh: 3 };
  return { rw: Number(m[1]), rh: Number(m[2]) };
}

/** 依据 imageSize 决定长边像素：够看清即可，太大只会拖慢本地联调。 */
function longSideFor(imageSize?: string): number {
  const v = (imageSize || "2K").trim().toUpperCase();
  if (v === "1K") return 512;
  if (v === "4K") return 896;
  return 640;
}

/** 画一张图，返回 dataURL。 */
export function paintMockImage(opts: MockImageOptions): string {
  const { rw, rh } = parseAspect(opts.aspectRatio);
  const long = longSideFor(opts.imageSize);
  const width = rw >= rh ? long : Math.round((long * rw) / rh);
  const height = rh >= rw ? long : Math.round((long * rh) / rw);

  const refs = (opts.referenceDataUrls || []).filter(Boolean);
  // 风格由参考图决定（同一批锚图 => 同一配色），细节由 prompt 决定。
  const seedA = hash32(refs[0]?.slice(0, 256) || "no-reference");
  const seedB = hash32(opts.prompt || "mock");
  const palette = pick(PALETTES, seedA);
  const rnd = seededRandom(seedB);

  const isSheet = /CHARACTER SHEET/i.test(opts.prompt);
  const unit = Math.min(width, height) * (isSheet ? 0.16 : 0.075);

  const shapes: Shape[] = [];
  const horizonY = Math.round(height * (isSheet ? 0.86 : 0.72));

  // 地面
  shapes.push({
    kind: "rect",
    x: 0,
    y: horizonY,
    w: width,
    h: height - horizonY,
    color: isSheet ? shade(palette.ground, 1.25) : palette.ground,
  });

  if (isSheet) {
    // 锚图：中性背景 + 单人大图（配色由「锚图内容 + 角色名」决定，不同角色不同色）
    const sheetSeed = seedA ^ seedB;
    const fur = pick(FIGURE_COLORS, sheetSeed);
    const cloth = pick(CLOTH_COLORS, sheetSeed >>> 3);
    shapes.push(...buildFigure(width / 2, horizonY + unit * 0.1, unit, fur, cloth));
  } else {
    // 太阳 / 月亮
    const sunX = Math.round(width * (0.16 + rnd() * 0.68));
    const sunY = Math.round(height * (0.12 + rnd() * 0.12));
    const sunR = Math.round(Math.min(width, height) * (0.05 + rnd() * 0.03));
    shapes.push({ kind: "circle", cx: sunX, cy: sunY, r: sunR, color: palette.sun });

    // 远处山丘 + 近处山丘
    shapes.push({
      kind: "ellipse",
      cx: Math.round(width * (0.2 + rnd() * 0.6)),
      cy: horizonY + Math.round(height * 0.16),
      rx: Math.round(width * 0.52),
      ry: Math.round(height * 0.3),
      color: palette.hillFar,
    });
    shapes.push({
      kind: "ellipse",
      cx: Math.round(width * (0.1 + rnd() * 0.8)),
      cy: horizonY + Math.round(height * 0.3),
      rx: Math.round(width * 0.46),
      ry: Math.round(height * 0.26),
      color: palette.hillNear,
    });

    // 角色：锚图数量决定人数，配色按锚图内容固定 => 跨页一致
    const figureCount = Math.max(1, Math.min(refs.length || 1, 3));
    for (let i = 0; i < figureCount; i++) {
      const refHash = hash32(refs[i]?.slice(0, 512) || `figure-${i}`);
      const fur = pick(FIGURE_COLORS, refHash);
      const cloth = pick(CLOTH_COLORS, refHash >>> 5);
      const fx = Math.round(width * ((i + 1) / (figureCount + 1)));
      const fy = horizonY + Math.round(height * (0.16 + rnd() * 0.06));
      shapes.push(...buildFigure(fx, fy, unit, fur, cloth));
    }
  }

  // 逐像素（先画的在下层）
  const buf = encodePng(width, height, (x, y) => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (hit(shapes[i], x, y)) return shapes[i].color;
    }
    const t = Math.min(1, y / Math.max(1, horizonY));
    return mix(palette.skyTop, palette.skyBottom, t);
  });

  return `data:image/png;base64,${buf.toString("base64")}`;
}
