# builders-backlinks.com

A free backlink exchange for indie builders, driven from your coding agent.

Submit a site, get matched with another builder in your category, and trade one link each. The whole exchange is exposed as an **MCP server**, so the trade happens where the work happens.

**Built by [nicklaunches.com](https://nicklaunches.com) · [@nicklaunches](https://x.com/nicklaunches)**

---

## Why MCP is the point, not a feature

Ranking Raccoon publishes that 71% of link requests get a reply and only 35% become a published link. So roughly half of *agreed* trades die, not because anyone changed their mind, but because placing the link means opening an editor, finding the right page, writing a sentence, committing, and deploying.

An agent is already sitting in that repository.

```
> trade a link

⏺ list_matches            a masked partner in your category
⏺ respond_to_match        both sides accept, identities unlock
⏺ get_link_brief          target URL, approved anchors, guidance
⏺ Edit content/blog/…     the agent writes it into your repo
⏺ mark_link_placed        ✓ verified live · content · dofollow
```

## Install

```bash
claude mcp add --transport http builders-backlinks \
  https://builders-backlinks.com/api/mcp \
  --header "Authorization: Bearer bb_live_..."
```

Get a key at `/app/key`. The read tools (`search_partners`, `get_categories`, `get_rules`) need no key at all, so the server connects and is useful before you sign in to anything.

Eleven tools, fully documented at [`/docs/mcp`](https://builders-backlinks.com/docs/mcp). Cursor, Codex, and Gemini CLI config is on that page too, though only the Claude Code and Cursor forms have been confirmed against the real clients.

## Local development

Requires Node 22+, pnpm, and a local PostgreSQL. The app lives in `next-app/`; there is no root package.

```bash
cd next-app
pnpm install
cp .env.example .env.local     # then fill it in
createdb builders_backlinks    # or point DATABASE_URL anywhere
pnpm db:migrate
pnpm dev
```

To see the inbox with something in it, seed a few threads:

```bash
pnpm seed:inbox                # local databases only; it refuses anything else
```

That writes four throwaway members and one thread per stage — undecided, waiting
on you, agreed and talking, both links live, expired — plus `.seed/inbox.json`
with their ids and sign-in cookies. `pnpm test:inbox` (the API) and `pnpm test:e2e`
(the browser) seed the same fixtures themselves.

`pnpm dev` is Next on Node, which is convenient and is *not* the production runtime. [CLAUDE.md](./CLAUDE.md) has the full command list, how to run it the way it actually deploys, and the workerd behaviour that only shows up there. What shipped, and when, is in [CHANGELOG.md](./CHANGELOG.md).

## Hosting

Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare), with Postgres (Neon in production) behind a Hyperdrive binding. Analytics is [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/), which is cookieless, and which is what keeps the claim on `/privacy` true: the only cookie this site sets is your sign-in session.

Deploys are automatic. Push to `main` and `.github/workflows/deploy.yml` typechecks, lints, tests, applies migrations, builds and deploys. Nothing is run by hand.

## Licence

MIT. See [LICENSE](./LICENSE).
