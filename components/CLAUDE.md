# UI conventions

Stack: Next 16 App Router · React 19 · Tailwind v4 · **Radix UI** (the unified
`radix-ui` package — NOT Base UI) · CVA · lucide-react · sonner · next-themes.

> The repo previously documented "Base UI, not Radix" — that was wrong. All
> `components/ui/*` import `from "radix-ui"`, and `asChild` (via Radix `Slot`) is
> supported (see `button.tsx`).

## Layout
- `components/ui/` — primitives (button, dialog, dropdown-menu, select, input,
  card, …). Each wraps a Radix primitive, spreads `{...props}`, adds a
  `data-slot="<name>"` attribute, and styles via `cn()`. Variants via **CVA**
  (`buttonVariants` etc.). Named exports.
- Feature folders: `app/` (shell: sidebar, account-menu, chat-store), `chat/`,
  `chats/`, `board/` (kanban supervisor), `cron/` (schedule UI), `settings/`,
  `administration/`, `auth/`, `ai-elements/` (message/tool/reasoning renderers),
  `brand/` (logo, `KnackLoader`).
- Files are **kebab-case**. `"@/..."` path alias throughout.

## Server vs client
- Pages/layouts are **server components** — fetch data (`await`, `Promise.all`)
  and pass it as props to a client child (e.g. `chat/[chatId]/page.tsx` → `<Chat>`).
- Mark only interactive components `"use client"`.
- Next 16: route `params` is a **Promise** — `const { chatId } = await params`.

## Styling
- `cn()` (`lib/utils.ts` = `clsx` + `tailwind-merge`) on every `className` prop.
- Tokens, fonts, brand utilities, and animations live in **`app/globals.css`**:
  brand vars (`--coral`, `--ink-*`, `--accent-deep`), `@utility knack-gradient` /
  `knack-glow`, `KnackLoader` keyframes. Fonts: Newsreader (serif headings, `.font-heading`),
  Hanken (sans body), Geist Mono. Dark mode via `next-themes` (`.dark` class).
- Common patterns: `focus-visible:ring-3 focus-visible:ring-ring/50`,
  `aria-invalid:*` for error states, `data-slot` for targeting.

## Forms & mutations
- **Server Actions**, co-located as `*-actions.ts` / `actions.ts` (`"use server"`,
  named exports). Client components import and call them **directly** in handlers
  (no API routes). Validate inside the action; `revalidatePath()` after mutating.
- Pending state = local `useState`; disable the button + show `<Spinner/>`.
- Feedback via **sonner**: `toast.success/error(...)`.

## Icons & loaders
- lucide named imports, sized with `className="size-4"`.
- `<Spinner/>` (`ui/spinner.tsx`, lucide `Loader2Icon` + `animate-spin`) for inline
  pending; `<KnackLoader/>` (`brand/loader.tsx`) for full-page/route loading
  (`loading.tsx`).

## Notable
- `components/app/chat-store.tsx` — a module-level `useSyncExternalStore` store
  (deliberately **not** React Context) for sidebar pending-chats + title overrides,
  so chat streaming doesn't re-render the shell.
- a11y: `sr-only` labels on icon buttons, `role="status"` on loaders, `aria-invalid`
  on bad inputs.
