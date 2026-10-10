# dsh-workspace-activity

Marks each workspace in the sidebar while one of its sessions is running.

A session row already shows a spinner while it runs. This plugin puts the same
spinner on the **workspace row above it**, so a collapsed or scrolled workspace
list still tells you which project is busy without expanding anything.

```
📁 dsh-workspace                    ◌      ← added by this plugin
   ◌ 处理所有 skill 同步到已同步      刚刚
```

## Install

```sh
dsh plugin --profile <name> add dsh-workspace-activity
```

Restart dsh, or reload the page. The plugin is a bundle, so it also works
through the plugin market and any other bundle-aware client.

## What it does

The sidebar shows no indicator on a workspace row today. The plugin derives one
from the same status feed the session rows use, so the two can never disagree:

- A workspace is marked when at least one of its sessions is running.
- Sessions the sidebar hides as archived are skipped.
- The status feed is authoritative; the session list is the fallback, matching
  the precedence the workspace browser itself uses.
- The mark is a spinner at the row's trailing edge, in the same 16px slot the
  session rows use for their timestamps, drawn with the product's own theme
  token and stroke geometry.
- A **collapsed** workspace also tints its folder glyph with the same blue the
  browser paints on the group you are inside. Collapsed rows hide their
  sessions, so the glyph has to carry the state alone; an expanded row already
  shows its sessions and keeps the browser's own colouring.
- Readers who cannot see it get the count and the workspace names through a
  visually hidden description.

## How it works

A workspace row declares no slot, so there is no supported place to render into.
The plugin instead contributes a stylesheet that decorates the row the sidebar
already renders. It writes nothing to the document, observes nothing, and appends
no nodes: the rule targets the row's trailing pseudo-element and React keeps
owning the row.

This is the one thing to know before installing it: **the rule targets the
sidebar's `data-row-key` attribute**, which is an internal detail of
`@deepseek-ai/dsh-client-ui-workspace` rather than a published contract. If a
future release renames it, the spinner stops appearing until the plugin is
updated. Nothing else breaks — the plugin never mutates the DOM, so a stale
selector degrades to "no indicator", not to a broken sidebar.

## Requirements

- A Web (or desktop) client — this is a client-only plugin, `dsh.client.platform: web`.
- No host services, no configuration, no permissions.

## Development

Written in TypeScript; `src/` is the source of truth and `lib/` is generated
(and committed — see below).

```sh
npm install
npm run build     # tsdown -> lib/, then wraps the Client half in the module envelope
npm run check     # typecheck + lint + format check + build + verify
```

| Script                    | What it does                                                     |
| ------------------------- | ---------------------------------------------------------------- |
| `build`                   | Emits `lib/index.js` and `lib/client.js`.                        |
| `verify`                  | Loads the built Client half and renders it with a real renderer. |
| `typecheck`               | `tsc --noEmit`.                                                  |
| `lint` / `lint:fix`       | ESLint, flat config.                                             |
| `format` / `format:check` | Prettier.                                                        |
| `check`                   | Everything above, in the order CI would run it.                  |

`build` runs `scripts/wrap-client.mjs` after tsdown: the Client half has to
reach the browser as a `window.__ModuleLoader__.load({ id, factory })` call
whose `id` is the package name, and the wrapper supplies that envelope.

`lib/` is committed on purpose. pnpm refuses to run a git dependency's
`prepare` script unless the consumer opts in with `allowBuilds`, so shipping the
built files is what lets `add` work straight from the repository. `prepare` runs
`build` as well, which keeps the committed output current on `npm install` and
`npm publish`.

`verify` is not a mock of the sidebar. It captures the factory the envelope
registers, drives `apply` against a stub context, and renders the registered
component with `react-test-renderer` — enough to prove the envelope, the
registration, and the stylesheet the entry publishes. The running sidebar is
still the only place the indicator's position and colour can be judged.

## License

MIT
