# Changelog

One version per deploy. `main` deploys on push, so a push members would notice
gets the next version and an entry here; a push they would not — a typo, a test,
a refactor — rides along under the one that follows it. The version in
`next-app/package.json` is the newest entry below, and the two move in the same
commit.

The member-facing half of each entry is published at
[builders-backlinks.com/changelog](https://builders-backlinks.com/changelog) and
in the app at `/app/changelog`, from `next-app/src/content/changelog.ts`; keep
the two in the same words. **Internal** notes live here only.

Versions before 0.6.0 were reconstructed from the git history on 2026-09-16 and
are deliberately coarse: they name the release a member would remember, not
every push that went out that week.

## 0.6.1 — 2026-09-16 — An account menu, and the footer everywhere

The header spent its most prominent slot on Sign out, and never said whose
account you were in.

- The header ends in an account menu: who you are signed in as, the way back to your dashboard, your sites, your key, and sign out.
- The footer is on every dashboard page now, not only on the marketing side.

### Internal

- The footer hangs off `PageFrame`, not the layout: the inbox sizes itself to the viewport, and anything the layout put under it would give the page a second scrollbar.
- Both bars blur what is behind them, and `backdrop-filter` makes an element its own stacking context — so the header is `z-20` and the tab bar `z-10` explicitly. Left to DOM order the tab bar wins and the account menu opens behind it.
- `callbacks.jwt` takes `name` and `picture` from the adapter's `users` row on the sign-in pass, so an edit to a member's display name survives the next OAuth sign-in instead of being overwritten by the provider.

## 0.6.0 — 2026-09-16 — A way out of an accept, and a floor on who you match with

Accepting was one click that could agree an exchange outright, with no way back.
And DR only ever nudged the ranking, so a DR 66 site could be offered a partner
with no authority at all.

- Accept asks once more, and says what the click commits you to.
- Withdraw from an exchange you already agreed to, until one of the two links goes live. Your partner is told, both sites go back in the pool, and nothing is owed either way.
- Set a minimum partner DR on each site. Nothing below it is proposed to you, and the floor applies in both directions.
- The control counts your pool as you move the number, and says so when a floor would leave you with nobody.
- Your listed sites open one at a time, with the floor visible on the closed row.
- Agents get set_matching_preferences, and respond_to_match now withdraws.

### Internal

- `exchange_sites` gains `min_partner_dr` and `skip_unrated`; `exchange_matches` gains `withdrawn_at` and `withdrawn_by_id`. All four additive, and a withdrawal is still stored as `declined`.
- The floor is `lib/matching/floor.ts`: pure, unit tested, the only DR rule that removes a candidate rather than scoring one. `selectPartner`, the digest sweep and both controls read it, and it is never restated in SQL.
- `respondToMatch` handles the withdrawal rather than a second service function, so the route and the MCP tool needed no new wiring. It deletes any placement row that was never live, because the recheck cron would otherwise keep crawling a link nobody is owed.
- Every script, Drizzle Kit and Playwright take `ENV_FILE`, and `pnpm dev:env` runs the dev server on the same file, so a suite and the server it drives cannot end up on different databases. Seeding refuses a remote database unless `DISPOSABLE_DB_HOST` names that exact host.
- `pnpm test:inbox` covers the withdraw window and its refusal once a link is live; the browser suite walks the confirm step, a withdrawal from both sides, and the sites list.

## 0.5.2 — 2026-09-14 — Inbox corrections

- A thread stopped asking for a decision you had already made.
- Badges and the overview were rebuilt around a green that is legible on paper.

## 0.5.1 — 2026-09-06 — Who has accepted, on the thread

- Acceptance states on every thread, and the waiting state that goes with them.

## 0.5.0 — 2026-09-04 — An inbox for every match, and a new dashboard

Two members could accept each other and then had no way, inside the product, to
say which page either link was going on.

- Every match is a thread: accept it, agree where the two links go, paste your page back for verification.
- Messaging opens only after you both accept. Until then neither side knows who the other is.
- A four-step rail on every thread: Decide, Agree, Add links, Live.
- Overview replaces the match cards, opening with what needs you and why.
- A Sites page listing everything you have submitted, and this changelog.
- Agents get list_messages and send_message, under the same rule as the browser.

## 0.4.3 — 2026-08-09 — Told the moment a link goes live

- Both sides are emailed when a placement is confirmed live, and when one comes down.

## 0.4.2 — 2026-08-07 — Nudges, instead of silence

- A reminder when an exchange is waiting on your link, at most one per match per night.
- A note when a match expires, saying both sites are back in the pool.

## 0.4.1 — 2026-08-06 — Matching got a heartbeat

Pairing ran once, at approval, so a site that missed that instant was invisible
to matching for good — 26 of 33 active sites had never been matched.

- Pairing runs nightly over every idle site, not only at approval.
- An agreed match can no longer be reopened by a stray decline.

## 0.4.0 — 2026-08-03 — Standing you cannot inflate

- Standing is counted from links that are actually live, in both directions.
- A match from an adjacent category says so on the match itself.
- Anchors are stripped of anything that could become markup on a partner's page.

## 0.3.0 — 2026-07-31 — Review before matching

- A site is matched only once a human has approved it.
- Both sides can accept in the same instant without one acceptance being lost.
- Re-reporting a placement corrects the first one instead of counting twice.

## 0.2.0 — 2026-07-28 — Workers, Postgres, and a dashboard

- Moved to Cloudflare Workers and Postgres, and the repository was opened.
- An /app dashboard, an admin review queue, and the four emails nobody was getting.
- Domain Rating is read correctly, and a missing score is treated as missing rather than as zero.

## 0.1.0 — 2026-07-27 — First build

- The MCP server: search, submit, match, place, verify.
- The landing page, the docs, sign-in, and the house rules.
