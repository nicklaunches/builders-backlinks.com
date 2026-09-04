import { config as loadEnv } from "dotenv";
import { like } from "drizzle-orm";

import type { Category } from "@/lib/categories";
import { db } from "@/lib/db";
import {
    type ExchangeSite,
    type User,
    exchangeLinks,
    exchangeMatches,
    exchangeMembers,
    exchangeMessages,
    exchangeSites,
    users,
} from "@/lib/db/schema";
import { orderPair } from "@/lib/exchange";

import { sessionCookieHeader } from "./dev-session";

loadEnv({ path: ".env.local", quiet: true });

/**
 * @file Seeds a local inbox worth looking at, and refuses to run anywhere else.
 *
 * `pnpm dev` against an empty database shows an empty inbox, which is exactly
 * the state that cannot be designed or tested against: every interesting
 * decision in the pane is about a thread that is mid-flight. This lays down one
 * thread per stage — waiting on you, waiting on them, agreed and talking, both
 * links live, and one that expired — so the rail, the tasks, the timeline and
 * the composer all have something real underneath them.
 *
 * IT DELETES ITS OWN FIXTURES FIRST and nothing else. Every row it writes hangs
 * off a user whose email ends in the seed suffix, so re-running is idempotent
 * and a hand-made local account survives it.
 *
 * It RETURNS what it made — ids, and a session cookie per member — so the smoke
 * suite and the browser suite can sign in as either side without an OAuth round
 * trip. `scripts/seed-inbox.ts` is the command-line wrapper that also writes
 * that to `.seed/inbox.json` for a human to read.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"]);

/** Everything this script owns is addressed by this suffix. */
const SUFFIX = "@seed.builders-backlinks.test";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * DAY);
const ahead = (days: number) => new Date(now + days * DAY);

function assertLocal(): void {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Point it at your local Postgres and try again.");

    let host: string;
    try {
        host = new URL(url).hostname;
    } catch {
        throw new Error("DATABASE_URL is not a valid URL.");
    }
    if (!LOCAL_HOSTS.has(host)) {
        throw new Error(
            `Refusing to seed ${host}. This writes fake members and matches, and is only ever meant for a local database.`,
        );
    }
}

/** What a caller gets back: enough to drive either surface as either member. */
export type SeedOutput = {
    generatedAt: string;
    people: Record<string, { userId: string; email: string; siteId: string; domain: string; cookie: string }>;
    matches: { proposed: string; waitingOnAda: string; agreed: string; placed: string; expired: string };
};

/** One seeded member: the login, the listing, and the row ids they own. */
type SeedRow = { person: SeedPerson; user: User; site: ExchangeSite };

type SeedPerson = {
    name: string;
    email: string;
    domain: string;
    category: Category;
    description: string;
    keywords: string[];
    domainRating: number;
};

const PEOPLE: SeedPerson[] = [
    {
        name: "Ada (seed)",
        email: `ada${SUFFIX}`,
        domain: "adatools.test",
        category: "Developer Tools",
        description:
            "A command-line toolkit for inspecting and replaying HTTP traffic while building an API, with a focus on reproducible request fixtures.",
        keywords: ["http debugging tool", "request replay", "api testing cli"],
        domainRating: 41,
    },
    {
        name: "Bo (seed)",
        email: `bo${SUFFIX}`,
        domain: "boships.test",
        category: "Developer Tools",
        description:
            "A deployment dashboard for small teams that shows what is running where, which commit it came from, and what changed since the last release.",
        keywords: ["deployment dashboard", "release tracking", "ship log"],
        domainRating: 37,
    },
    {
        name: "Cy (seed)",
        email: `cy${SUFFIX}`,
        domain: "cyanalytics.test",
        category: "Analytics",
        description:
            "Privacy-first product analytics that answers which features are used and which are quietly ignored, without cookies or session recording.",
        keywords: ["product analytics", "privacy analytics", "feature usage"],
        domainRating: 52,
    },
    {
        name: "Di (seed)",
        email: `di${SUFFIX}`,
        domain: "distudio.test",
        category: "Marketing",
        description:
            "A landing page studio for founders who would rather ship one honest page than maintain a marketing site nobody reads.",
        keywords: ["landing page builder", "founder marketing", "one page site"],
        domainRating: 29,
    },
];

async function wipe(): Promise<void> {
    // Sites, matches, links, messages and read cursors all cascade from `users`,
    // so one delete on the seed suffix takes the whole fixture with it and
    // touches nothing a developer created by hand.
    await db()
        .delete(users)
        .where(like(users.email, `%${SUFFIX}`));
}

export async function seedInbox(): Promise<SeedOutput> {
    assertLocal();
    await wipe();

    const created: SeedRow[] = [];
    for (const person of PEOPLE) {
        const [user] = await db()
            .insert(users)
            .values({ name: person.name, email: person.email, emailVerified: ago(30) })
            .returning();
        if (!user) throw new Error(`Could not create ${person.email}`);

        await db()
            .insert(exchangeMembers)
            .values({ userId: user.id, email: person.email, verifiedAt: ago(30) });

        const [site] = await db()
            .insert(exchangeSites)
            .values({
                ownerId: user.id,
                domain: person.domain,
                url: `https://${person.domain}`,
                category: person.category,
                keywords: person.keywords,
                description: person.description,
                domainRating: person.domainRating,
                trueDr: person.domainRating - 4,
                drCheckedAt: ago(9),
                placementOffered: "blog_post",
                status: "active",
                statusChangedAt: ago(25),
                lastMatchedAt: ago(4),
            })
            .returning();
        if (!site) throw new Error(`Could not create the site for ${person.email}`);

        created.push({ person, user, site });
    }

    const [ada, bo, cy, di] = created;
    if (!ada || !bo || !cy || !di) throw new Error("Seed people did not all get created.");

    /** Writes one match with the pair ordered the way the unique index needs. */
    async function match(input: {
        left: SeedRow;
        right: SeedRow;
        state: "proposed" | "a_accepted" | "b_accepted" | "agreed" | "placed" | "expired";
        createdAt: Date;
        agreedAt?: Date;
        expiresAt: Date;
        acceptedBy?: SeedRow[];
    }) {
        const [siteAId, siteBId] = orderPair(input.left.site.id, input.right.site.id);
        const acceptStamp = (side: "a" | "b") => {
            const siteId = side === "a" ? siteAId : siteBId;
            const who = created.find((c) => c.site.id === siteId);
            return input.acceptedBy?.some((person) => person.site.id === who?.site.id) ? input.createdAt : null;
        };

        const [row] = await db()
            .insert(exchangeMatches)
            .values({
                siteAId,
                siteBId,
                category: input.left.person.category,
                score: 72,
                state: input.state,
                createdAt: input.createdAt,
                updatedAt: input.agreedAt ?? input.createdAt,
                agreedAt: input.agreedAt ?? null,
                aAcceptedAt: acceptStamp("a"),
                bAcceptedAt: acceptStamp("b"),
                expiresAt: input.expiresAt,
            })
            .returning();
        if (!row) throw new Error("Could not create a seeded match.");
        return row;
    }

    // 1. Fresh proposal: nobody has answered.
    const proposed = await match({
        left: ada,
        right: di,
        state: "proposed",
        createdAt: ago(1),
        expiresAt: ahead(13),
    });

    // 2. Waiting on Ada: Cy accepted first, so Ada's pane shows the ball in her court.
    const waiting = await match({
        left: ada,
        right: cy,
        state: orderPair(ada.site.id, cy.site.id)[0] === cy.site.id ? "a_accepted" : "b_accepted",
        createdAt: ago(2),
        expiresAt: ahead(12),
        acceptedBy: [cy],
    });

    // 3. Agreed and talking: the thread the inbox exists for.
    const agreed = await match({
        left: ada,
        right: bo,
        state: "agreed",
        createdAt: ago(6),
        agreedAt: ago(5),
        expiresAt: ahead(8),
        acceptedBy: [ada, bo],
    });

    await db()
        .insert(exchangeMessages)
        .values([
            {
                matchId: agreed.id,
                senderUserId: bo.user.id,
                senderSiteId: bo.site.id,
                body: [
                    `Hi — happy to get this moving.`,
                    ``,
                    `I have a post going live this week on release tracking for small teams, and your request-replay workflow fits the section about reproducing a bad deploy. Dofollow, inside the body copy, not a table row.`,
                    ``,
                    `Which page of yours would you rather I point at, the docs landing or the CLI overview?`,
                ].join("\n"),
                createdAt: ago(5),
            },
            {
                matchId: agreed.id,
                senderUserId: ada.user.id,
                senderSiteId: ada.site.id,
                body: [
                    `The CLI overview, thanks — that is the page people actually land on.`,
                    ``,
                    `From my side you would go in the "shipping" section of https://adatools.test/guides/http-fixtures, which is a real guide rather than a links page. I will use "deployment dashboard" as the anchor unless you would rather have something else.`,
                ].join("\n"),
                createdAt: ago(4),
            },
            {
                matchId: agreed.id,
                senderUserId: bo.user.id,
                senderSiteId: bo.site.id,
                body: "That anchor is perfect. Mine goes out Thursday, I will paste the URL here when it is live.",
                createdAt: ago(1),
            },
        ]);

    // 4. Finished: both links live, so the rail is at its last step.
    const placed = await match({
        left: cy,
        right: di,
        state: "placed",
        createdAt: ago(40),
        agreedAt: ago(38),
        expiresAt: ahead(2),
        acceptedBy: [cy, di],
    });

    await db()
        .insert(exchangeLinks)
        .values([
            {
                matchId: placed.id,
                fromSiteId: cy.site.id,
                toSiteId: di.site.id,
                pageUrl: `https://${cy.person.domain}/blog/what-we-measure`,
                anchorText: "landing page builder",
                status: "live",
                placement: "content",
                rel: [],
                firstSeenAt: ago(35),
                lastCheckedAt: ago(3),
                checkCount: 3,
                createdAt: ago(36),
            },
            {
                matchId: placed.id,
                fromSiteId: di.site.id,
                toSiteId: cy.site.id,
                pageUrl: `https://${di.person.domain}/notes/measuring-a-launch`,
                anchorText: "privacy analytics",
                status: "live",
                placement: "content",
                rel: [],
                firstSeenAt: ago(34),
                lastCheckedAt: ago(3),
                checkCount: 3,
                createdAt: ago(35),
            },
        ]);

    // 5. Expired, for the closed-thread rendering.
    const expired = await match({
        left: bo,
        right: di,
        state: "expired",
        createdAt: ago(30),
        expiresAt: ago(16),
    });

    const output: SeedOutput = {
        generatedAt: new Date().toISOString(),
        people: Object.fromEntries(
            await Promise.all(
                created.map(async (c) => [
                    c.person.domain.split(".")[0],
                    {
                        userId: c.user.id,
                        email: c.person.email,
                        siteId: c.site.id,
                        domain: c.person.domain,
                        // What the end-to-end suite signs in with. Worthless off
                        // this machine: it is encrypted with the local secret.
                        cookie: await sessionCookieHeader({ id: c.user.id, email: c.person.email }),
                    },
                ]),
            ),
        ),
        matches: {
            proposed: proposed.id,
            waitingOnAda: waiting.id,
            agreed: agreed.id,
            placed: placed.id,
            expired: expired.id,
        },
    };

    return output;
}
