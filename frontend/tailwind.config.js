/** @type {import('tailwindcss').Config} */
export default {
  // 单一明快暖色主题：darkMode 设为 class 但从不加 dark 类，
  // 使旧代码中遗留的 dark: 变体自动失效，呈现统一暖色（去 AI 味的关键之一）。
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 主色：赤陶（决策 2）
        brand: {
          DEFAULT: "#C8643C",
          strong: "#A84E2C",
          soft: "#F3E2D6",
        },
        // 点缀：暖金（决策 2）
        gold: {
          DEFAULT: "#E0A458",
          soft: "#F8EEDB",
        },
        // 墨色文字 / 纸感背景
        ink: "#2B2620",
        paper: {
          DEFAULT: "#FBF7F0",
          2: "#F4ECE0",
          3: "#EBDFCB",
        },
        // muted 为装饰性浅色，正文级次要文字用 strong（对纸色底 5.6:1，满足 AA）
        muted: {
          DEFAULT: "#8C8073",
          strong: "#6B6157",
        },
        // 暖调成功/已配音（替代冷绿 emerald）
        sage: {
          DEFAULT: "#6F8F6B",
          soft: "#E6EFE2",
        },
        line: "#E6DAC8",
      },
      fontFamily: {
        display: ['"Noto Serif SC"', "Georgia", "serif"],
        sans: ['"PingFang SC"', '"Microsoft YaHei"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 6px 24px rgba(43,38,32,0.08)",
        card: "0 2px 10px rgba(43,38,32,0.06)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
