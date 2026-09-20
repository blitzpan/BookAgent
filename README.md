# 📖 BookAgent  
**Orchestrating Safety-Aware Visual Narratives via Multi-Agent Cognitive Calibration**

[![Paper](https://img.shields.io/badge/Paper-ACL%20Findings-blue)](https://arxiv.org/abs/2604.16541)  

---

## 🚀 Overview

We introduce **BookAgent**, a safety-aware multi-agent framework for **end-to-end visual storybook generation**.  
Unlike prior pipelines that decouple text and image generation, BookAgent **jointly plans, generates, verifies, and repairs** multi-modal narratives.

> 💡 Unlike stage-wise pipelines, BookAgent introduces a **closed-loop cognitive generation paradigm** for long-horizon multi-modal storytelling.

---

## 🧠 Framework

<p align="center">
  <img src="assets/framework.png" width="90%">
</p>

BookAgent is built upon a **closed-loop multi-agent architecture** with three key stages:

- **Value-Aligned Storyboarding (VAS)**  
  Ensures safety and transforms raw drafts into structured story plans.

- **Iterative Cross-modal Refinement (ICR)**  
  A generate–verify–revise loop that enforces **text-image grounding** and identity consistency.

- **Temporal Cognitive Calibration (TCC)**  
  Performs **global reasoning and selective repair** to maintain long-horizon consistency.

---

## 🖥️ Demo Interface

<p align="center">
  <img src="assets/demo.png" width="90%">
</p>

We build a fully functional interactive system for storybook creation, supporting:

- ✏️ Story input and page control  
- 🎨 Style customization  
- 🔁 Iterative global refinement  
- 🧩 Character consistency via reference sheets  

---

## 🚀 Run Locally

### Prerequisites
- Node.js

### Steps

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set your API key in `.env.local`:
   ```bash
   GEMINI_API_KEY=your_api_key_here
   ```

3. Run the app:
   ```bash
   npm run dev
   ```

---

## ✨ Key Features

- 🔁 **Closed-loop generation (not one-shot)**
- 🎭 **Character identity consistency across pages**
- 🧠 **Multi-agent collaboration**
- 🛡️ **Child-safe content generation**
- 📚 **Long-horizon narrative reasoning**

---

## 📊 Results

BookAgent significantly improves:

- 📖 Narrative coherence  
- 🧍 Character consistency  
- 🛡️ Safety compliance  

compared to prior methods such as StoryGPT-V and MovieAgent.

---

## 🔌 Multi-Model Support

This branch (`feat/multi-model-support`) makes every AI call pluggable per **role**:
`TEXT` (story/characters), `IMAGE` (illustration), and `VISION` (consistency directors).
By default everything runs on **Gemini**, preserving the original behavior 100%.

You can switch **each role independently** to a domestic provider, so the whole
pipeline runs without touching Google's API at all:

```bash
# .env.local — fully domestic, no Gemini calls
TEXT_PROVIDER=qwen       # Alibaba Qwen (text)
IMAGE_PROVIDER=seedream  # ByteDance Seedream (image)
VISION_PROVIDER=qwen     # Alibaba Qwen-VL (vision/VLM judging)
QWEN_API_KEY=your_dashscope_key
SEEDREAM_API_KEY=your_volcengine_ark_key
```

Or switch just the image model:

```bash
# .env.local
IMAGE_PROVIDER=seedream
SEEDREAM_API_KEY=your_volcengine_ark_key
```

Or run **everything on Volcengine Ark** (Doubao for text/vision + Seedream for images)
with a single API key:

```bash
# .env.local — all roles on Volcengine Ark, one key
TEXT_PROVIDER=ark
IMAGE_PROVIDER=ark
VISION_PROVIDER=ark
ARK_API_KEY=your_volcengine_ark_key
```

Or run **everything on Alibaba Bailian** (Qwen for text, Qwen-VL for vision judging,
Tongyi Wanxiang for images — native multi-reference support) with a single API key:

```bash
# .env.local — all roles on Alibaba Bailian, one key
TEXT_PROVIDER=bailian
IMAGE_PROVIDER=bailian
VISION_PROVIDER=bailian
BAILIAN_API_KEY=your_dashscope_key
```

See [MULTI_MODEL.md](./MULTI_MODEL.md) for the architecture, CORS proxy setup, and how to add new providers.

---

## 🙏 Acknowledgements

We thank **Google AI Studio** for providing an intuitive platform for rapid prototyping and deployment of our interactive demo system.

---

## 📌 Citation

```bibtex
@article{gao2026bookagent,
  title={BookAgent: Orchestrating Safety-Aware Visual Narratives via Multi-Agent Cognitive Calibration},
  author={Gao, Bo and Liu, Chang and Miao, Yuyang and Ma, Siyuan and Lim, Ser-Nam},
  journal={ACL Findings},
  year={2026}
}
```
