# builders-backlinks.com

A free backlink exchange for indie builders, exposed as an MCP server so the trade
happens inside the member's coding agent. See `README.md` for what it is and why.

## Orientation

One Next.js app, nested one level down in `next-app/`. There is no root
`package.json` and no pnpm workspace, so **every command runs from `next-app/`**.
Path alias `@/*` maps to `next-app/src/*`; relative imports are rare.

```
next-app/src/
  app/            App Router. (site)/ is the marketing shell, api/mcp/ is the MCP
                  endpoint, api/cron/* are the two scheduled jobs.
  lib/services/   The data-access seam. Everything goes through here.
  lib/db/         Drizzle schema and the per-request connection handle.
  lib/mcp/        Tool registration. No logic of its own.
  lib/limits.ts   Per-tool budgets, spent by the tools and the server actions alike.
  lib/exchange.ts Pure domain rules, and enum values derived from the pgEnums.
  components/web/ All shared components, flat, kebab-case, named exports.
  emails/         React Email templates.
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next on Node. Convenient, and **not** the production runtime. |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint, including the layering rule below |
| `pnpm format` | Prettier. Do not hand-order imports, this does it. |
| `pnpm test` | Node's built-in runner over `src/**/*.test.ts` |
| `pnpm test:mcp` | Drives the server with the real MCP SDK client. Needs a running server and Postgres. |
| `pnpm emails:render` | Renders every template to `.render/` for eyeballing |
| `pnpm assets:generate` | Redraws the favicon, OG image and logo from `scripts/assets/`. Hand-run; commit the output |
| `pnpm preview` | Build for Workers and serve it locally |
| `pnpm run deploy` | Migrate, build, deploy from your machine |
| `pnpm cf-typegen` | Regenerate `worker-configuration.d.ts` after a binding change |
| `pnpm db:generate` | Write a migration from `src/lib/db/schema.ts` |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Drizzle Studio |

`pnpm run deploy`, not `pnpm deploy`. In pnpm 10 `deploy` is a built-in
workspace command and silently shadows the script.

`pnpm test:mcp` is the meaningful test. It exercises the server exactly as an
agent would, over the real protocol, and it writes and deletes one throwaway user.

## Architecture, in three rules

**1. One service layer.** MCP tools and web routes both call `src/lib/services/*`.
A tool handler contains no logic. The moment a tool does something a web route
would not, the agent path and the browser path have started to drift, and the
agent path is supposed to be first-class. `eslint.config.mjs` enforces this: code
under `src/lib/mcp/**` and `src/app/api/mcp/**` cannot import `@/lib/db`, the
Drizzle table objects, `drizzle-orm`, or the `analyze` and `verify` leaf modules.
Types and enums from the schema are fine, it is data *access* that is banned.

**2. The masking boundary is structural.** A partner's domain and email are not
returned by any read path before a match is agreed. This is enforced by types,
not discipline: `MaskedPartner` (`src/lib/contracts.ts`) has no `domain` field to
accidentally populate, and `toRevealedPartner` throws unless handed an agreed
match. There is deliberately no lint rule on top of it, and `eslint.config.mjs`
explains why at length. Do not add one.

**3. Placements are classified, never refereed.** Verification records whether a
link sits in content or a footer and whether it is dofollow, then shows both
parties what was given and received. It rejects nothing. Members were promised
that where the link lands is their call. Adding a rejection branch is a product
decision, not a bug fix.

## Runtime traps

**A database client cached across requests does not error, it hangs.** workerd
binds an I/O object to the request that opened it. `src/lib/db/index.ts` therefore
keeps one Drizzle handle per request in a `WeakMap` keyed on the `ExecutionContext`,
and `db()` resolves the connection string at call time, never at module load. Do
not hoist it into a module-level `const`.

**The Hyperdrive connection string arrives on the Cloudflare context, not as an
env var.** `DATABASE_URL` exists only for scripts, drizzle-kit, tests and `pnpm dev`.
In the Worker it is the binding or nothing.

**`pnpm dev` will not catch either of the above.** Before trusting a change:

```bash
pnpm exec opennextjs-cloudflare build
pnpm exec wrangler dev --port 8788 --test-scheduled
MCP_SMOKE_BASE=http://localhost:8788 pnpm test:mcp
```

`--test-scheduled` exposes the cron handler over HTTP, so the two jobs can be
fired by hand:

```bash
curl "http://localhost:8788/__scheduled?cron=0+9+*+*+2"   # weekly digest
curl "http://localhost:8788/__scheduled?cron=0+4+*+*+*"   # expiry, re-pair, link rechecks
```

The daily job also re-pairs every active site holding no open match, which
proposes matches and emails both sides. It takes `?dry=1` when reached over HTTP
directly, which logs the pairs it would create and writes and sends nothing —
worth using before pointing it at production for the first time:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://builders-backlinks.com/api/cron/recheck?dry=1"
```

**Migrations run before the deploy**, in CI and in `pnpm run deploy` alike, so the
schema is never behind the code. That is only safe while migrations are additive.
A dropped or renamed column breaks the still-running old version the moment it
applies, so split destructive changes across two deploys: stop using the column,
ship, then drop it.

**`NEXT_PUBLIC_*` is inlined into the browser bundle at build time.** It has to be
present during the build step, which is why `NEXT_PUBLIC_SITE_URL` is a repository
*variable* and not a Worker secret. As a secret it would arrive too late to be
inlined at all.

**Cron Triggers invoke `scheduled()`, they do not fetch a URL.** OpenNext emits a
fetch-only worker, so `worker.ts` wraps it and dispatches each cron expression to
the matching `/api/cron/*` route over a synthetic request. Adding a cron means
editing both `wrangler.jsonc` `triggers.crons` and `CRON_ROUTES` in `worker.ts`.

**SES is regional, and this app uses `us-west-2`.** The identity, its DKIM
tokens, the sending quota and production access are all per-region, and an
identity verified in one region is invisible from another. `us-west-2` was
chosen because the account already holds production access there; `us-east-1`
was sandboxed at 200 sends a day. The IAM policy on `builders-backlinks-ses`
scopes to the region-qualified identity ARN, so changing region means reissuing
the DKIM CNAMEs and rewriting that ARN as well as `AWS_REGION` in
`wrangler.jsonc`.

## "They said they never got the email"

Every send is attributed to the `builders-backlinks` SES configuration set and
tagged `email_type` with the template name, so this is answerable rather than a
guess. Account-wide numbers are useless here: the same AWS account sends a few
thousand a day for other projects.

```bash
# Did that template deliver at all today? Swap in match-proposed, digest, welcome, ...
aws cloudwatch get-metric-statistics --region us-west-2 --namespace AWS/SES \
  --metric-name Delivery --dimensions Name=email_type,Value=match-proposed \
  --start-time "$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 86400 --statistics Sum

# Is this specific person blocked? A prior hard bounce or complaint suppresses
# an address ACCOUNT-WIDE, so another project's bounce silences ours too.
aws sesv2 get-suppressed-destination --region us-west-2 --email-address them@example.com
```

`Delivery` means the receiving server accepted it. If Delivery fired and they
still cannot find it, it is filtering on their side, not a bug here: a young
sending domain lands in spam even with DKIM and DMARC correct, which ours are.

Failures (bounce, complaint, reject, delivery delay, render failure) also
publish to the `builders-backlinks-ses-alerts` SNS topic and are emailed, so
they arrive rather than waiting to be noticed. Verified with a real drill
against `bounce@simulator.amazonses.com`, which SES exempts from both reputation
and the suppression list, so it is safe to repeat.

## Data invariants

Encoded in `src/lib/db/schema.ts` as constraints, not just conventions:

- `exchange_sites.domain` is globally unique. One domain belongs to one member, ever.
- `exchange_matches` is unique on `(site_a, site_b)`, with `site_a` **always** the
  lexicographically smaller uuid. Enforced in code by `orderPair` in
  `src/lib/exchange.ts`. Write a pair in the other order and the uniqueness
  constraint stops meaning anything.

Enum values are derived from the pgEnums via `src/lib/exchange.ts` rather than
re-declared, so the database constraint and the TypeScript union cannot drift.
Add a status in `schema.ts` and it is valid everywhere; remove one and every use
site becomes a compile error rather than a runtime surprise.

## Auth

Two independent paths.

**People** sign in with Google or GitHub (NextAuth v5, JWT sessions, Drizzle
adapter). `src/lib/session.ts` is the single session-lookup seam: `getSessionUser`
and `getSessionMember`, and nothing outside it should import `@/auth` except the
route handler and the sign-in server actions that have to. Both providers verify
email ownership, which is what makes `allowDangerousEmailAccountLinking` safe;
adding a provider that does not means revisiting that flag.

**Agents** present a `bb_live_…` bearer key, minted at `/app/key`, stored hashed,
resolved in `src/lib/auth/api-key.ts`. Anonymous MCP callers are allowed through
to the read tools by design, so the server is useful before anyone signs in.

Cron routes fail **closed** without `CRON_SECRET`. The rate limiter fails **open**
on a database error, deliberately: it is abuse control, not a security boundary.

## Conventions

Prettier at 4 spaces, 120 columns, `bracketSameLine`, with enforced import order
(third-party, then `react/*`, then `@/*`, then relative, blank-line separated).
Run `pnpm format` rather than arranging imports by hand.

Shared components live flat in `src/components/web/` with kebab-case filenames and
named exports. Components used by exactly one route sit beside that route instead.

Theming is CSS custom properties in `src/app/globals.css` (`--bg`, `--surface`,
`--line`, `--fg`, `--muted`, `--accent`, `--focus`, `--term-*`), consumed as
Tailwind v4 utilities: `bg-bg`, `text-muted`, `border-line`. No hex literals in
components. The accent role is split three ways for contrast reasons.

Tests are colocated `*.test.ts` on node's built-in runner via `tsx`. Pure logic
like `matching/score.ts` is kept free of database and network access specifically
so it stays testable that way.

**Keep the `@file` JSDoc blocks.** They are the strongest convention in this repo
and they record *why* a decision was made and what was tried first: the neon-http
driver that Hyperdrive rejected, the workerd hang, the module-level `let` bug, the
accent-colour contrast math. They are the reason this codebase is cheap to return
to. Write them for new files and extend them when you change the reasoning.

## Two interfaces, one service layer

Every capability exists twice: as an MCP tool in `src/lib/mcp/tools.ts`, and as a
browser surface. `/app` is the dashboard (matches, accept/decline, link brief,
mark placed, ledger, standing), `/submit` lists a site, `/app/key` issues the
bearer token, `/admin` is the review queue. Both paths call the same
`src/lib/services/*` functions, which is the entire reason they cannot drift.

Two things to know before touching `/app`:

- **The masking boundary is not lint-enforced there.** The ESLint layering rule
  covers `src/lib/mcp/**` and `src/app/api/mcp/**` only. `src/app/app/**` sits
  outside it, so the protection is that `listMatches` hands back a
  `MaskedPartner` until both sides accept and that type has no `domain` field.
  Never add a raw `db()` call to a dashboard page.
- **`MatchView.nextStep` is written for agents** and says things like "call
  `get_link_brief`". `match-card.tsx` maps state to UI wording instead. Do not
  "fix" the service copy: it is correct for its caller.

## Known gaps

- `MCP_SMOKE_BASE` is used by `scripts/mcp-smoke.ts` but is not in `.env.example`.
- **Nobody can propose a trade with a chosen partner** (issue #18). Matching is
  entirely server-initiated, by two triggers, both calling `autoPair`:
  `setSiteStatus` on approval (the fast path) and the daily re-pair pass in
  `api/cron/recheck` (the safety net). It does **not** run on submit, and the
  weekly digest does not pair anyone either — that cron writes nothing but
  `lastDigestSentAt`. `search_partners` still returns `MaskedPartner.partnerId`,
  which now has no consumer at all.
  This used to be a documentation gap that had become a member-facing one:
  `mask.ts` claimed the id was an argument to `propose_trade`, and `digest.tsx`
  believed it and printed `propose_trade partnerId="…"` under every candidate
  plus as the primary CTA. A member followed the instruction on 2026-08-03,
  found no such tool, and said so publicly. The advertising is gone; the
  capability is still missing. Do not re-add a call to action here without
  building the thing behind it.
- **Nobody knows how 33 sites became `active`.** On 2026-08-06, every site was
  `active`, 26 of them had never been matched, and the matcher would have paired
  24 on the spot — the engine was fine, the trigger was the problem. `autoPair`
  ran only at the approval instant, so a site that missed it was invisible to
  matching forever. There was also no `POST /admin` anywhere in the six-day
  Workers log window while ~22 sites went active, which points at activation
  outside the app, but request logs may be sampled and `console.log` is not in
  that view, so it was never proven. Two things came out of it: the daily
  re-pair pass, which makes the cause moot operationally, and
  `exchange_sites.status_changed_at` / `status_changed_by`, written only by
  `setSiteStatus`. **An `active` row with a NULL `status_changed_by` did not
  become active through this application.** The 33 original rows are all NULL
  and are deliberately not backfilled, so the signal starts clean.
- **A member cannot edit or pause their own listing.** `setSiteStatus` is
  admin-gated and there is no function to change a description, category or
  keywords after submission. A member who wants to fix a bad analysis has no path
  except asking an admin to reject it.
- `exchangeMembers.digestCadence` (`weekly | biweekly | paused`) is read by the
  digest cron and written by nothing. Only `unsubscribedAt` is user-controllable.
- `src/components/web/install-tabs.tsx` still carries `TODO(verify)` markers: the
  Codex and Gemini CLI config forms have never been confirmed against the real
  clients. Only the Claude Code and Cursor forms have.
- **A site with no Domain Rating is now worth investigating.** This entry used to
  say the opposite, and was wrong twice over: the analyzer called
  `/lookup/{domain}`, which serves only domains approved on verifieddr.com, so
  nearly every site 404'd and stored a null DR that looked like vendor coverage.
  `/dr/{domain}` relays Ahrefs DR for any domain and is the primary call as of
  2026-08-01; TrueDR still needs `/lookup` and is still legitimately null for
  most members. The seven rows the bug left behind were backfilled by hand on
  2026-08-01 and the throwaway script was deleted, so there is still **no path
  that re-scores an existing site**: nothing re-runs the analyzer after
  submission, and `dr_checked_at` is written once and read by nothing. If a
  scoring bug lands again, the repair is another one-off script.
- CI runs `pnpm db:migrate`, which skips the `assert-prod-db.ts` guard that
  `db:migrate:deploy` has. That is intentional: CI's `DATABASE_URL` comes from a
  repository secret. Do not "fix" it.
