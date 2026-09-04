# Changelog

What shipped, newest first. The member-facing half of each entry is also
published at [builders-backlinks.com/changelog](https://builders-backlinks.com/changelog)
from `next-app/src/content/changelog.ts`; keep the two in the same words.

## 2026-09-04 — An inbox for every match, and a new dashboard

Until now two members could accept each other and then had no way, inside the
product, to say which page either link was going on. Every match is now a
conversation, and the dashboard around it was rebuilt so the first thing you
see is what needs you.

### Inbox

- Every match has a thread. The list is on the left, the conversation on the right; on a phone it is one pane at a time.
- Messaging opens only after you both accept. Until then neither side knows who the other is, and the composer says so.
- A four-step rail on every thread: Decide, Agree, Add links, Live. A declined or expired thread keeps the rail, dimmed, under a banner.
- Accept or decline from inside the thread, with a reason box for a decline.
- Report your placement from the thread: paste the page URL and, optionally, the anchor, and we verify it there and then. Both sides' tasks are listed, so you can see who owes what.
- A copy-ready link snippet for the partner's site, in HTML, Markdown, MDX or JSX.
- A suggested opening message on a fresh thread, naming both sites and asking the two questions these threads always ask: which page, and dofollow or not.
- Enter sends, Shift+Enter adds a line. New messages arrive without a reload while the tab is open.
- Unread counts on the Inbox tab, updated as you read.

### Dashboard

- Overview replaces the old match cards. It opens with your standing and three numbers (sites, links given, links received), then a "Needs you" list of only the threads waiting on you, each saying why: a new message, a decision, a link to add, a link we could not find. The link ledger follows.
- A tab bar for the signed-in app: Overview, Inbox, Sites, API key. They are ordinary links, so the back button and a link from an email land where you expect.
- A Sites page listing every site you have submitted, with its status and a given/received count.
- The API key page lost its masthead; the key panel is the first thing on it.
- Signed in, the home page takes you straight to Overview. Signing out lands on the home page.

### Email

- When a partner writes to you, the email quotes their message rather than summarising it, with a button straight into the thread.
- It is deliberately quiet: at most one such email per thread every three hours, and none at all if you opened the thread in the last fifteen minutes.

### Agents

- Two MCP tools, `list_messages` and `send_message`, so an agent can read and write the same thread you see in the browser, under the same rule: nothing before both sides accept.

### Fixes

- A thread that reached agreement and then expired no longer masks itself again. Once you have been shown a partner, you keep being shown them.
- A page URL that is not http(s) is refused when you report it, rather than stored and reported as inconclusive.
- Pressing Enter while composing with an input method editor (Japanese, Chinese, Korean input) no longer sends a half-typed message.
- An unknown thread address answers 404 rather than an error page.

### Privacy

- The site now uses Google Analytics 4 alongside Cloudflare Web Analytics. It records page views and five product events (submitting a site, issuing a key, accepting, declining, sending a message), never a domain, an email address or the text of a message. It sets cookies, and the privacy notice now says so.

### Internal

- A thread is a match: messages hang off `exchange_matches`, and the system half of a timeline (proposal, acceptances, reveal, placements, verifications) is derived from timestamps rather than stored. `a_accepted_at` and `b_accepted_at` were added so the first acceptance has a time.
- `src/lib/services/threads.ts` is the one service behind `/app/inbox`, `/api/inbox/*`, `list_messages` and `send_message`.
- `/api/inbox/*` are route handlers rather than server actions, because the inbox polls; every mutation there calls `assertSameOrigin` from `src/lib/api.ts`.
- `pnpm test:inbox` drives every inbox route with minted session cookies; `pnpm test:e2e` drives the UI as two members in Playwright; `pnpm seed:inbox` fills a local database with a thread at every stage.
- `match-card.tsx` and `app/actions.ts` are gone: accept, decline and placement all moved into the thread pane.
- GA4 is rendered from the root layout and is off unless `NEXT_PUBLIC_GA_ID` is set at build time; the event names live in `src/lib/analytics.ts`.
