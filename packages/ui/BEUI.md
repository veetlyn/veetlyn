# beUI components (vendored)

Source: the `@beui` shadcn registry (https://beui.dev, MIT, repo `starc007/ui-components`), registered in
`components.json`. Installed from `packages/ui`:

```bash
yes n | pnpm dlx shadcn@latest add @beui/<slug>
```

`yes n` declines the prompt to overwrite `src/lib/utils.ts`; keep ours (`cn` from the `cn` package is a drop-in for
`twMerge(clsx(...))`). After an install, remove any `clsx` / `tailwind-merge` the CLI adds to `package.json`.

Vendored paths: `src/components/motion/**`, `src/components/agents/**`, `src/lib/hooks/**`, `src/lib/ease.ts`,
`src/lib/i18n.tsx`, `src/lib/focusable.ts`. Also `src/lib/command-search.ts`, `src/lib/presence-gate.tsx`, `src/lib/touch.ts`.
They follow beUI's conventions, so `.oxlintrc.json` turns off the house-style anti-slop rules for them only, and
`tsconfig.beui.json` type-checks them without `noUncheckedIndexedAccess` (beUI's own setting; `check-types` runs both
configs). A few early guards remain in tabs, select, i18n, use-listbox and use-row-cursor; they are harmless if a
re-install drops them. `.tsx` lib files need an explicit entry in `package.json` `exports` (`./lib/i18n`,
`./lib/presence-gate`).

Tokens: beUI reads the shadcn semantic tokens. The dash sets beUI's neutral values with the platform's brand in
`apps/web/src/dash.css` (ink primary, mint `--brand` in place of beUI's cyan, Cal Sans / Inter / Geist Mono).

In use:
- `motion/tabs`: projects list filter.
- `agents/prompt-input`: the assistant composer (`apps/web/src/components/composer-box.tsx`).
- `motion/command-palette`: top-bar search (`app-frame.tsx`); focus returns to the trigger on close.
- `motion/table`: client payments ledger, sortable, money right-aligned.
- `motion/alert`: billing notice, kept `role="status"` (tested in `billing-notice.test.ts`).
- `motion/breadcrumb`: top-bar breadcrumb; switcher crumbs keep our dropdown menu.

Not used, on purpose: `timeline` (a decorative card carousel, not a status sequence) and `select` for the workspace
picker (a listbox for form values; the picker is a menu of navigation links).
