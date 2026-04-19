# sushii-docs

Documentation site and landing page for [sushii bot](https://github.com/drklee3/sushii-2). Built with **Next.js 15 + Fumadocs**, exported as a fully static site.

## Stack

- [Next.js 15](https://nextjs.org/) — static export (`output: "export"`)
- [Fumadocs](https://fumadocs.vercel.app/) — docs framework (MDX content pipeline + UI)
- [Tailwind CSS](https://tailwindcss.com/) — utility classes for docs pages
- [next/font](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) — Mochiy Pop One, Plus Jakarta Sans, JetBrains Mono

## Commands

| Command      | Action                                  |
| :----------- | :-------------------------------------- |
| `bun dev`    | Start local dev server at `localhost:3000` |
| `bun build`  | Build static site to `./dist/`          |
| `bun start`  | Preview the static build locally        |

## Project Structure

```
app/
  page.tsx          # Landing page (custom inline styles)
  (docs)/           # Fumadocs-powered /docs section
  privacy/          # Static legal pages
  tos/
  _components/      # Shared React components (Navbar, GlyphField, etc.)
  global.css        # Sushii design tokens + Fumadocs variable overrides
content/
  docs/             # MDX source files (sidebar order via meta.json)
lib/
  source.ts         # Fumadocs loader
source.config.ts    # Fumadocs MDX config
```

## Adding docs content

Add `.md` or `.mdx` files under `content/docs/`. Each file becomes a route under `/docs` based on its path. Use `meta.json` in each directory to control sidebar title and page order.
