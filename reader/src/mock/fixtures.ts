// 本地示例数据，用于后端不可运行时的 UI 联调（VITE_USE_MOCK=true）。
// 结构对齐 docs/reader-dev-prompt.md §2 真实响应。

import type { ReaderPage, ShelfBook } from "../types";

export function mockStories(): ShelfBook[] {
  return [
    { id: 1, userTitle: "小熊的奇妙一天", status: "审批通过的作品", pageCount: 6, createdAt: null, coverUrl: null },
    { id: 2, userTitle: "The Lost Star", status: "审批通过的作品", pageCount: 4, createdAt: null, coverUrl: null },
    { id: 3, userTitle: "海边的礼物", status: "审批通过的作品", pageCount: 5, createdAt: null, coverUrl: null },
  ];
}

const ZH = [
  "清晨，小熊推开窗户，阳光洒满了整个房间。",
  "他背起小书包，蹦蹦跳跳地走向森林学校。",
  "路上，一只小兔子递给他一朵刚采的野花。",
  "课堂上，老师讲起了星星的故事，大家都听入迷了。",
  "放学后，小熊和朋友们在草地上放风筝。",
  "夜深了，小熊抱着野花，甜甜地进入了梦乡。",
];
const EN = [
  "In the morning, Little Bear opened the window and sunshine filled the room.",
  "He put on his bag and hopped happily to the forest school.",
  "On the way, a little rabbit handed him a freshly picked wildflower.",
  "In class, the teacher told a story about stars, and everyone listened with wonder.",
  "After school, Little Bear flew a kite on the grass with his friends.",
  "Late at night, Little Bear hugged the flower and fell into a sweet dream.",
];

export function mockBook(storyId: number): ReaderPage[] {
  const n = storyId === 2 ? 4 : storyId === 3 ? 5 : 6;
  const base = storyId === 2 ? "star" : storyId === 3 ? "sea" : "bear";
  return Array.from({ length: n }, (_, i) => ({
    pageNumber: i + 1,
    textZh: ZH[i % ZH.length],
    textEn: EN[i % EN.length],
    imageUrl: `https://picsum.photos/seed/${base}${i + 1}/900/1200`,
  }));
}
