# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`sushii-docs` — the public-facing documentation and landing page for sushii bot. Built with **Next.js 15 + Fumadocs** (not Astro/Starlight — the README is stale boilerplate).

## Commands

```bash
bun dev       # dev server at localhost:3000
bun build     # static export → ./dist/
bun start     # preview the static export
```

Output is a fully static site (`output: "export"` in `next.config.ts`).

## Architecture

### Content (MDX)

- **`content/docs/`** — MDX source files, organized into sections with `meta.json` files for sidebar ordering
- **`source.config.ts`** — Fumadocs MDX config (`defineDocs` pointing at `content/docs/`)
- **`lib/source.ts`** — Fumadocs `loader()` that turns the MDX source into a typed API used by page routes

### App routes

- **`app/page.tsx`** — marketing landing page (no Fumadocs, fully custom inline styles)
- **`app/(docs)/`** — Fumadocs-powered docs section at `/docs`
- **`app/privacy/`**, **`app/tos/`** — static legal pages

### Design system

All styling is via CSS custom properties defined in `app/global.css`. Use these tokens — do not hardcode color values:

| Token | Role |
|---|---|
| `--sushi-bg` | Page background |
| `--sushi-card` / `--sushi-card2` | Card surfaces |
| `--sushi-ink` / `--sushi-ink2` | Primary / secondary text |
| `--sushi-outline` | Hard shadow / border color (`#1c1b2e`) |
| `--sushi-pink` / `--sushi-lilac` / `--sushi-blue` / `--sushi-gold` | Accent palette |

The landing page uses inline styles (not Tailwind classes) with these tokens. Fumadocs pages map them via `--fd-*` variable overrides in `global.css`.

Fonts loaded via `next/font/google`:
- `--font-display` — Mochiy Pop One (headings)
- `--font-body` — Plus Jakarta Sans (body)
- `--font-mono` — JetBrains Mono (code / command chips)
