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

## 0.6.4 — 2026-09-19 — An agreed exchange no longer runs out of time

Both of you said yes. Nothing should close that but one of you, so the countdown
now belongs to the decision and stops the moment the decision is made.

- Once both sides accept, the exchange stays open until the links go live or one of you withdraws.
- A match you accept late is a real agreement now, instead of one that could lapse the same night.
- An unanswered proposal still lapses after 14 days, and both sites go straight back into the pool.
- The reminder about a link you still owe keeps coming — weekly for the first month, monthly after that — and says how to step out.
- A thread shows a date to decide by only while there is still a decision to make.

### Internal

- `OPEN_MATCH_STATES` split in two. `UNDECIDED_MATCH_STATES` is the expiry sweep's list; `OPEN_MATCH_STATES` is it plus `agreed` and still answers "is this site busy?" for the digest, the re-pair pass and `selectPartner`. The split is the fix: `expires_at` is stamped once at proposal and nothing ever moves it, so sweeping `agreed` closed an agreement against a deadline set two weeks before it existed.
- The reported case, exactly: proposed day 0, one side accepted day 0, the other accepted on day 14 — inside the gap between the deadline passing and the daily sweep, so `respondToMatch`'s state guard let it through — and the next cron run expired the eight-hour-old agreement. Late acceptance is now durable rather than something the following run tears down, which is why no accept-time deadline check was added.
- The placement nudge backs off instead of stopping: weekly from day 3, monthly past day 30, forever. An agreed match has no deadline any more, so this mail is the only thing keeping a forgotten one visible, and holding one keeps both sites out of the pool. Every send still honours unsubscribe in `email/send.ts`.
- `match-expired` lost `wasAgreed` and `placement-pending` lost its "Match expires" row: both were branches on a state that can no longer reach them.
- Known gap, deliberately left: `assertNothingLive` refuses a withdrawal once either link is live, so an agreement where one side placed and the other never does has no release at all now. It nudges monthly forever and both sites stay out of the pool. Giving the side that placed a way out is the follow-up.

## 0.6.3 — 2026-09-16 — An account menu, a star count, and DR that stays current

Three things the product was missing: somewhere to see whose account you are in,
a way to find the code, and a Domain Rating that does not quietly go stale.

- The header ends in an account menu: who you are signed in as, the way back to your dashboard, your sites, your key, and sign out.
- The footer is on every dashboard page now, not only on the marketing side.
- A star count in the header, linking to the repository.
- Every active site's DR is re-read about twice a week.
- A lookup that fails leaves your score exactly as it was rather than blanking it.

### Internal

- The footer hangs off `PageFrame`, not the layout: the inbox sizes itself to the viewport, and anything the layout put under it would give the page a second scrollbar.
- Both bars blur what is behind them, and `backdrop-filter` makes an element its own stacking context — so the header is `z-20` and the tab bar `z-10` explicitly. Left to DOM order the tab bar wins and the account menu opens behind it.
- `callbacks.jwt` takes `name` and `picture` from the adapter's `users` row on the sign-in pass, so an edit to a member's display name survives the next OAuth sign-in instead of being overwritten by the provider.
- The star count is cached per isolate for an hour on top of `revalidate`, because this ships on workerd with no incremental cache configured — without it a header that renders on every request is a GitHub call on every request, against a sixty-an-hour limit on an IP shared with the whole colo. Every failure path still renders the link, without a number.
- `content/links.ts` owns the off-site addresses; the footer and the badge were about to hold two copies of the repository URL.
- `/api/cron/authority` at 02:30 and 14:30 UTC, taking the 24 stalest sites older than 3.5 days, oldest first, NULLS FIRST. The age filter is what makes the cadence per-site; the batch is what keeps a run inside VerifiedDR's 60-a-minute window. Sequential by design — a `Promise.all` over the batch is a burst for no gain on a job nobody waits for.
- Watch the monthly quota: ~95 sites twice a week is roughly 820 units a month before submissions, against 1,000 on the Pro plan. `STALE_AFTER_DAYS` is the one number to raise; seven halves it.
- A failed DR lookup stamps `dr_checked_at` and writes no scores, so a permanently failing domain cannot sit at the head of the queue burning a unit per run. That column means "when we last asked".
- Only `active` sites are refreshed. A rejected or banned listing is never in a pool, and a paused one rejoins the cadence when it comes back.

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
