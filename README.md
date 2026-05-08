# Markdown Preview

Landing page for [Markdown Preview](https://github.com/pluk-inc/markdown-preview), a native macOS app for reading Markdown files. Lives at [markdownpreview.app](https://markdownpreview.app/).

Built with Astro + Tailwind, deployed as static assets to Cloudflare Workers.

## Project structure

```text
.
├── public/                # Favicons, screenshots, static assets
├── src/
│   ├── assets/            # Images processed by Astro (app icon, etc.)
│   ├── components/        # FeatureCard.astro
│   ├── layouts/           # Layout.astro — <head>, analytics, fonts
│   ├── pages/             # index.astro — the landing page
│   └── styles/            # global.css — design tokens, typography
├── astro.config.mjs
├── wrangler.jsonc         # Cloudflare static-asset deploy config
└── package.json
```

The page expects screenshots under `public/screenshots/` (e.g. `hero@2x.png`, `feels-native@2x.png`). Missing images fall back to inline mocks rendered in `index.astro`, so the page stays presentable without them.

## Commands

Requires Node ≥ 22.12 and `pnpm`.

| Command         | Action                                       |
| :-------------- | :------------------------------------------- |
| `pnpm install`  | Install dependencies                         |
| `pnpm dev`      | Start dev server at `localhost:4321`         |
| `pnpm build`    | Build the static site to `./dist/`           |
| `pnpm preview`  | Preview the production build locally         |
| `pnpm astro …`  | Run the Astro CLI                            |

## Deployment

The site deploys to Cloudflare Workers as a pure static asset bundle — there is no Worker script. `wrangler.jsonc` points the `assets` directory at `./dist`, so the flow is:

```sh
pnpm build
pnpm dlx wrangler versions upload    # or `wrangler deploy`
```

## Analytics

PostHog is loaded in `src/layouts/Layout.astro`. The `phc_*` project key is a public client token and is safe to commit.

## License

MIT — see [LICENSE](./LICENSE).
