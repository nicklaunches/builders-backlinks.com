/**
 * @file What shipped, one entry per version worth telling members about.
 *
 * This array is the single source for `/changelog` and `/app/changelog`, and
 * the root `CHANGELOG.md` mirrors it by hand for people reading the repository.
 * When an entry is added here, add it there too, in the same words.
 *
 * ONE VERSION PER DEPLOY. `main` deploys on push, so a push members would
 * notice gets the next version and an entry; a push they would not — a typo, a
 * test, a refactor — rides along under the one that follows it. The number in
 * `next-app/package.json` is the version at the top of this list, and the two
 * move in the same commit.
 *
 * Versions before 0.6.0 were reconstructed from the git history on 2026-09-16
 * and are deliberately coarse: they name the release a member would remember,
 * not every push that went out that week.
 *
 * SLUGS ARE STABLE ONCE PUBLISHED. `2026-09-04-inbox` keeps its date-shaped
 * anchor because an announcement email already points at it; everything else is
 * anchored by version.
 *
 * Entries are written for a member, not for the engineer who built the thing:
 * what they can now do, in as few lines as that takes. Internal changes go in
 * `CHANGELOG.md` under "Internal", not here.
 */

export type ChangelogEntry = {
    /** The version this shipped as. Matches `package.json` for the newest entry. */
    version: string;
    /** ISO date of the deploy. */
    date: string;
    /** Anchor id. Stable once published: emails link to it. */
    slug: string;
    title: string;
    /** One line. Why this release happened, in the member's terms. */
    summary: string;
    /** What changed. One line each, no sub-headings. */
    items: readonly string[];
};

/** Newest first. The first entry is the current version. */
export const CHANGELOG: readonly ChangelogEntry[] = [
    {
        version: "0.6.0",
        date: "2026-09-16",
        slug: "v0-6-0",
        title: "A way out of an accept, and a floor on who you match with",
        summary:
            "Accepting was one click that could agree an exchange outright, with no way back. And DR only ever nudged " +
            "the ranking, so a DR 66 site could be offered a partner with no authority at all.",
        items: [
            "Accept asks once more, and says what the click commits you to.",
            "Withdraw from an exchange you already agreed to, until one of the two links goes live. Your partner is told, both sites go back in the pool, and nothing is owed either way.",
            "Set a minimum partner DR on each site. Nothing below it is proposed to you, and the floor applies in both directions.",
            "The control counts your pool as you move the number, and says so when a floor would leave you with nobody.",
            "Your listed sites open one at a time, with the floor visible on the closed row.",
            "Agents get set_matching_preferences, and respond_to_match now withdraws.",
        ],
    },
    {
        version: "0.5.2",
        date: "2026-09-14",
        slug: "v0-5-2",
        title: "Inbox corrections",
        summary: "Two things the inbox got wrong in its first week.",
        items: [
            "A thread stopped asking for a decision you had already made.",
            "Badges and the overview were rebuilt around a green that is legible on paper.",
        ],
    },
    {
        version: "0.5.1",
        date: "2026-09-06",
        slug: "v0-5-1",
        title: "Who has accepted, on the thread",
        summary: "A thread now says which side has answered rather than leaving you to guess.",
        items: ["Acceptance states on every thread, and the waiting state that goes with them."],
    },
    {
        version: "0.5.0",
        date: "2026-09-04",
        slug: "2026-09-04-inbox",
        title: "An inbox for every match, and a new dashboard",
        summary:
            "Two members could accept each other and then had no way, inside the product, to say which page either " +
            "link was going on.",
        items: [
            "Every match is a thread: accept it, agree where the two links go, paste your page back for verification.",
            "Messaging opens only after you both accept. Until then neither side knows who the other is.",
            "A four-step rail on every thread: Decide, Agree, Add links, Live.",
            "Overview replaces the match cards, opening with what needs you and why.",
            "A Sites page listing everything you have submitted, and this changelog.",
            "Agents get list_messages and send_message, under the same rule as the browser.",
        ],
    },
    {
        version: "0.4.3",
        date: "2026-08-09",
        slug: "v0-4-3",
        title: "Told the moment a link goes live",
        summary: "Verification used to happen quietly.",
        items: ["Both sides are emailed when a placement is confirmed live, and when one comes down."],
    },
    {
        version: "0.4.2",
        date: "2026-08-07",
        slug: "v0-4-2",
        title: "Nudges, instead of silence",
        summary: "An agreed exchange could sit waiting on a link with nobody saying so.",
        items: [
            "A reminder when an exchange is waiting on your link, at most one per match per night.",
            "A note when a match expires, saying both sites are back in the pool.",
        ],
    },
    {
        version: "0.4.1",
        date: "2026-08-06",
        slug: "v0-4-1",
        title: "Matching got a heartbeat",
        summary:
            "Pairing ran once, at approval, so a site that missed that instant was invisible to matching for good — " +
            "26 of 33 active sites had never been matched.",
        items: [
            "Pairing runs nightly over every idle site, not only at approval.",
            "An agreed match can no longer be reopened by a stray decline.",
        ],
    },
    {
        version: "0.4.0",
        date: "2026-08-03",
        slug: "v0-4-0",
        title: "Standing you cannot inflate",
        summary: "Given and received were stored counters that two write paths disagreed about.",
        items: [
            "Standing is counted from links that are actually live, in both directions.",
            "A match from an adjacent category says so on the match itself.",
            "Anchors are stripped of anything that could become markup on a partner's page.",
        ],
    },
    {
        version: "0.3.0",
        date: "2026-07-31",
        slug: "v0-3-0",
        title: "Review before matching",
        summary: "/terms promised every listing is reviewed. Submitting matched you before anyone had looked.",
        items: [
            "A site is matched only once a human has approved it.",
            "Both sides can accept in the same instant without one acceptance being lost.",
            "Re-reporting a placement corrects the first one instead of counting twice.",
        ],
    },
    {
        version: "0.2.0",
        date: "2026-07-28",
        slug: "v0-2-0",
        title: "Workers, Postgres, and a dashboard",
        summary: "The exchange moved to its production runtime and grew the screens it was missing.",
        items: [
            "Moved to Cloudflare Workers and Postgres, and the repository was opened.",
            "An /app dashboard, an admin review queue, and the four emails nobody was getting.",
            "Domain Rating is read correctly, and a missing score is treated as missing rather than as zero.",
        ],
    },
    {
        version: "0.1.0",
        date: "2026-07-27",
        slug: "v0-1-0",
        title: "First build",
        summary: "The exchange, and the agent surface that drives it.",
        items: [
            "The MCP server: search, submit, match, place, verify.",
            "The landing page, the docs, sign-in, and the house rules.",
        ],
    },
];

/** The version now in production. The first entry, by definition. */
export const CURRENT_VERSION = CHANGELOG[0]!.version;
