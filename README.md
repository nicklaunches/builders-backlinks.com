# builders-backlinks.com

A free backlink exchange for indie builders, driven from your coding agent.

Submit a site, get matched with another builder in your category, and trade one link each. The whole exchange is exposed as an **MCP server**, so the trade happens where the work happens.

**Built by [nicklaunches.com](https://nicklaunches.com) · [@nicklaunches](https://x.com/nicklaunches)**

---

## Why MCP is the point, not a feature

Ranking Raccoon publishes that 71% of link requests get a reply and only 35% become a published link. So roughly half of *agreed* trades die, not because anyone changed their mind, but because placing the link means opening an editor, finding the right page, writing a sentence, committing, and deploying.

An agent is already sitting in that repository. It can accept the match, write the link into a real page in the member's own words, and report it back for verification. That gap is the whole reason this exists.

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

Requires Node 20+, pnpm, and a local MongoDB.

```bash
pnpm install
cp next-app/.env.example next-app/.env.local   # then fill it in
mongod --dbpath /tmp/bb-mongo --port 27717     # or point MONGODB_URI anywhere
pnpm dev
```

| Command            | What it does                                                                    |
| ------------------ | ------------------------------------------------------------------------------- |
| `pnpm test`      | Unit tests for the matching engine                                              |
| `pnpm test:mcp`  | End-to-end MCP checks over the real protocol (needs a running server and Mongo) |
| `pnpm typecheck` | `tsc --noEmit`                                                                |
| `pnpm lint`      | ESLint, including the layering rules below                                      |

`pnpm test:mcp` is the meaningful one: it drives the server with the official MCP SDK client, exactly as an agent would.

## Architecture, in three rules

**1. One service layer.** MCP tools and web routes both call `src/lib/services/*`. A tool handler contains no logic. The moment a tool does something a web route would not, the agent path and the browser path have started to drift, and the agent path is supposed to be first-class. There is an ESLint rule enforcing this.

**2. The masking boundary is structural.** A partner's domain and email are not returned by any read path before a match is agreed. This is enforced by types, not discipline: `MaskedPartner` has no `domain` field to accidentally populate, and `toRevealedPartner` throws unless handed an agreed match. See `src/lib/services/mask.ts`.

**3. Placements are classified, never refereed.** Verification records whether a link sits in content or a footer, and whether it is dofollow, then shows both parties exactly what was given and received. It does not reject anything. Members were promised that where the link lands is their call. If you are about to add a rejection branch, that is a product decision, not a bug fix.

## Two things worth knowing before you read the code

**Accounts are shared with nicklaunches.com.** Both apps point NextAuth's MongoDB adapter at the same `users` and `accounts` collections, so the same person resolves to the same `_id` on both domains, and `AUTH_SECRET` must match between them. No secret is in this repository, but publishing the code does document that the two properties share an auth boundary. That is deliberate and worth being explicit about rather than leaving a reader to infer it.

**The anti-abuse logic is public.** Rate-limit budgets (`src/lib/mcp/limits.ts`), placement classification (`src/lib/verify`), and the intake rules are all readable. Nothing here relied on obscurity: the identity protection is the type-level boundary above, and the rate limiter is abuse control rather than a security boundary (it deliberately fails open on a database error).

## Licence

MIT. See [LICENSE](./LICENSE).
