import { createPreset } from "fumadocs-ui/tailwind-plugin";
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./node_modules/fumadocs-ui/dist/**/*.js",
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./content/**/*.{md,mdx}",
    "./mdx-components.tsx",
  ],
  presets: [createPreset()],
  theme: {
    extend: {
      colors: {
        "sushi-pink": "var(--sushi-pink)",
        "sushi-lilac": "var(--sushi-lilac)",
        "sushi-blue": "var(--sushi-blue)",
        "sushi-gold": "var(--sushi-gold)",
        "sushi-bg": "var(--sushi-bg)",
        "sushi-outline": "var(--sushi-outline)",
        "sushi-ink": "var(--sushi-ink)",
        "sushi-ink2": "var(--sushi-ink2)",
        "sushi-card": "var(--sushi-card)",
        "sushi-card2": "var(--sushi-card2)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
};

export default config;
