# Agent guidance

One Next.js app, nested one level down in `next-app/`. There is no root
`package.json` and no pnpm workspace, so **every command runs from `next-app/`**.
Path alias `@/*` maps to `next-app/src/*`.

## Engineering principles

- Prefer simple, readable, flat code with minimal indirection.
- Search for existing implementations and installed libraries before creating new helpers or abstractions.
- Abstract when it prevents meaningful drift and makes the result simpler to maintain. Avoid speculative or one-use abstraction layers.
- Keep product data normalized and relationships explicit. Do not encode relational data in JSON or text merely to avoid joins.
- For new application-backed backend functionality, default to: MCP tool handler / server action / route handler → `src/lib/services/*` → Drizzle. A tool handler contains no logic of its own. `eslint.config.mjs` enforces the layering: code under `src/lib/mcp/**` and `src/app/api/mcp/**` cannot import `@/lib/db`, the Drizzle table objects, `drizzle-orm`, or the `analyze` and `verify` leaf modules. Types and enums from the schema are fine — it is data *access* that is banned.
- Every capability exists twice, as an MCP tool and as a browser surface, and both call the same service. The moment a tool does something a web route would not, the agent path and the browser path have started to drift.
- Postgres only. Migrations run **before** the deploy, in CI and in `pnpm run deploy` alike, so keep them additive: a dropped or renamed column breaks the still-running old version the moment it applies. Split destructive changes across two deploys — stop using the column, ship, then drop it.
- Derive enum values from the pgEnums via `src/lib/exchange.ts` rather than re-declaring them, so the database constraint and the TypeScript union cannot drift.
- Use idiomatic TypeScript. Use Zod to validate untrusted data and narrow runtime values at trust boundaries: MCP tool inputs (`src/lib/mcp/tools.ts`), server-action `FormData`, cron query params, and responses from OpenRouter and VerifiedDR.
- Prefer established project helpers over hand-rolled implementations. `errorDetail` (`src/lib/log.ts`) rather than a bare `console.error` — it walks `cause`, which is where Drizzle keeps the driver's real explanation, and a raw caught error renders in workerd as a minified stack. `orderPair` (`src/lib/exchange.ts`) for every match pair. `db()` per request. `cn` for class merging.
- Prefer idiomatic Next App Router patterns: server components read, server actions write, `useActionState` / `useTransition` on the client. Format dates on the server so the render and the hydration cannot disagree.
- Theming is CSS custom properties in `src/app/globals.css`, consumed as Tailwind v4 utilities (`bg-bg`, `text-muted`, `border-line`). No hex literals in components.
- Run `pnpm format` rather than arranging imports by hand. Prettier at 4 spaces, 120 columns, with enforced import order.

## Comments and JSDoc

Document the symbol, not the line above it: anything explaining an export, a type
or a constant belongs in a `/** */` attached to it, where it surfaces on hover.

**Shape.** A symbol's JSDoc is a summary line plus at most two short paragraphs.
An inline `//` run is at most three lines — anything longer either compresses or
belongs on the enclosing symbol. No ASCII banner separators.

**Keep** the summary line, constraints on future edits ("keep the catch
swallowing", "NULLS FIRST or the query buries new members"), non-obvious
mechanism, and every `@throws`.

**Cut:**

- **Archaeology.** "This used to be", "previously", "the reference implementation
  did". A past failure survives only as the constraint it imposes now, not as its
  own account. The incident narratives live in `@file` blocks — the integer-score
  bug in `matching/score-integer.test.ts`, the minified-stack lesson in
  `lib/log.ts` — and are told there once.
- **Anything this file already says.** The service-layer seam, "use
  `errorDetail`", the masking boundary in general terms. Restating a project rule
  at each site is how it drifts.
- **Signature restatement.** `@param siteId - The site to move.` Keep a tag only
  where it carries something the type does not.
- **Narration of the adjacent line.** "Pairing is awaited rather than fired and
  forgotten" sitting above `await autoPair(site)`.
- **A fact already in this module's `@file` block.** State it once, up top, and
  point at it from below.

**Keep the `@file` block on every module.** It is the canonical home for
module-level reasoning and what was tried first — the neon-http driver Hyperdrive
rejected, the workerd hang, the accent-colour contrast math — and it is the reason
the blocks below it can stay short. Extend it when you change the reasoning.

## Testing

Tests are colocated `*.test.ts` on node's built-in runner via `tsx`. There is no
mocking library, and that is a constraint worth keeping.

- Don't add tests just for the sake of it. A test exists to enforce core behavior or a hard-to-spot edge case that could actually occur.
- Keep tests as simple as possible, and always review them looking for simplifications.
- Test behavior at the public entry point. Assert argument forwarding to a mocked collaborator only when that mapping is the contract.
- Keep pure logic free of database and network access so a test can import it directly. `matching/score.ts` and `analyze/describe.ts` are whole modules kept that way; `anchorPhrase` and `briefFor` are pure exports that live inside modules which do touch the database, and are tested on their own.
- Don't mock ORM builder chains. Chain mocks break on refactors that change no behavior. Services are covered instead by `pnpm test:mcp` and `pnpm test:cron`, which drive the real protocol and the real cron against a real Postgres.
- Fixtures contain only the fields the test asserts on or the types require. Shared shapes get a factory with overrides — see `BASE` + `candidate()` in `matching/score-integer.test.ts` and `partner()` in `services/links.test.ts`. A fixture longer than its test's assertions is a smell.
- One test per invariant. Don't re-test Zod or a library, and don't repeat an output-schema round-trip in every happy path.
- Two assertions were written after the thing they check had already failed in production, and must not be softened. `test:mcp` audits the server's prose for tool names that do not exist: every snake_case token in a tool description or answer must be a registered tool or a pgEnum value. Do not turn that into an allowlist to make a failure go away. `test:cron` seeds an **odd** number of sites, because an even pool cannot produce the bug it is there to catch.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next on Node. Convenient, and **not** the production runtime. |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint, including the layering rule above |
| `pnpm format` | Prettier |
| `pnpm test` | Node's built-in runner over `src/**/*.test.ts` |
| `pnpm test:mcp` | Drives the server with the real MCP SDK client. Needs a running server and Postgres. |
| `pnpm test:cron` | Drives the daily re-pair pass over a seeded pool. Localhost only. |
| `pnpm emails:render` | Renders every template to `.render/` |
| `pnpm assets:generate` | Redraws the favicon, OG image and logo. Hand-run; commit the output |
| `pnpm preview` | Build for Workers and serve it locally |
| `pnpm run deploy` | Migrate, build, deploy. Not `pnpm deploy` — in pnpm 10 that is a built-in workspace command and silently shadows the script |
| `pnpm cf-typegen` | Regenerate `worker-configuration.d.ts` after a binding change |
| `pnpm db:generate` / `db:migrate` / `db:studio` | Drizzle Kit |

`pnpm dev` cannot reproduce the two workerd traps this app is shaped around — the
request-scoped database handle and the Hyperdrive binding — so check a change
against the real runtime before trusting it:

```bash
pnpm exec opennextjs-cloudflare build
pnpm exec wrangler dev --port 8788 --test-scheduled
MCP_SMOKE_BASE=http://localhost:8788 pnpm test:mcp
```
