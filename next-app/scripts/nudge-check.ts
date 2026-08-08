import { config as loadEnv } from "dotenv";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { exchangeLinks, exchangeMatches, exchangeMembers, exchangeSites, users } from "@/lib/db/schema";
import { orderPair } from "@/lib/exchange";

loadEnv({ path: ".env.local", quiet: true });

/**
 * @file Throwaway check for the placement-nudge pass in `api/cron/recheck`.
 *
 * The pass decides WHO gets mailed, and the only interesting part is that it
 * mails exactly the side holding up the trade. An empty database says nothing
 * about that: the route returns `nudged: 0` whether the selection is right or
 * completely broken.
 *
 * Seeds one agreed match, five days old, with a single live link from A to B,
 * so the correct answer is unambiguous: B owes a link, A does not, so exactly
 * one send. Then runs the pass twice, because `lastNudgedAt` existing at all is
 * the reason a nightly job does not become a nightly mailshot.
 *
 * LOCALHOST ONLY. Seeds and deletes its own rows.
 */

const BASE = process.env.CRON_BASE ?? "http://localhost:8788";
const SECRET = process.env.CRON_SECRET ?? "";
const DAY = 24 * 60 * 60 * 1000;

if (!/^http:\/\/localhost:/.test(BASE)) {
    console.error(`Refusing to run against ${BASE}. Localhost only.`);
    process.exit(1);
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` (${detail})` : ""}`);
    if (!ok) failures++;
}

async function runPass(): Promise<number> {
    const res = await fetch(`${BASE}/api/cron/recheck`, { headers: { Authorization: `Bearer ${SECRET}` } });
    const body = (await res.json()) as { nudged: number };
    return body.nudged;
}

const stamp = Date.now();
const seeded = [
    { letter: "a", domain: `nudge-a-${stamp}.test`, email: `nudge-a-${stamp}@example.test`, userId: "", siteId: "" },
    { letter: "b", domain: `nudge-b-${stamp}.test`, email: `nudge-b-${stamp}@example.test`, userId: "", siteId: "" },
];

// Wrapped rather than top level: the tsx transform for these scripts emits CJS,
// which has no top-level await.
async function main() {
    console.log(`Nudge pass check against ${BASE}\n`);

    try {
        for (const site of seeded) {
            const [user] = await db().insert(users).values({ email: site.email }).returning({ id: users.id });
            site.userId = user.id;
            await db().insert(exchangeMembers).values({ userId: user.id, email: site.email, verifiedAt: new Date() });
            const [row] = await db()
                .insert(exchangeSites)
                .values({
                    ownerId: user.id,
                    domain: site.domain,
                    url: `https://${site.domain}`,
                    category: "Developer Tools",
                    description: `Throwaway listing ${site.letter} for the nudge pass check.`,
                    keywords: ["one", "two"],
                    placementOffered: "blog_post",
                    domainRating: 30,
                    status: "active",
                })
                .returning({ id: exchangeSites.id });
            site.siteId = row.id;
        }

        const [siteAId, siteBId] = orderPair(seeded[0].siteId, seeded[1].siteId);
        const agreedAt = new Date(Date.now() - 5 * DAY);

        const [match] = await db()
            .insert(exchangeMatches)
            .values({
                siteAId,
                siteBId,
                category: "Developer Tools",
                score: 50,
                state: "agreed",
                agreedAt,
                expiresAt: new Date(Date.now() + 9 * DAY),
            })
            .returning({ id: exchangeMatches.id });

        // Only A has placed. B is the sole debtor, so B is the only correct target.
        await db()
            .insert(exchangeLinks)
            .values({
                matchId: match.id,
                fromSiteId: siteAId,
                toSiteId: siteBId,
                pageUrl: `https://${seeded[0].domain}/blog/the-post`,
                status: "live",
                placement: "content",
                rel: [],
                firstSeenAt: new Date(),
                lastCheckedAt: new Date(),
                checkCount: 1,
            });

        const first = await runPass();
        check("mails exactly the one side that owes a link", first === 1, `nudged=${first}`);

        const [afterFirst] = await db()
            .select({ lastNudgedAt: exchangeMatches.lastNudgedAt })
            .from(exchangeMatches)
            .where(eq(exchangeMatches.id, match.id));
        check("stamps lastNudgedAt", afterFirst?.lastNudgedAt != null);

        const second = await runPass();
        check("a second run the same day sends nothing", second === 0, `nudged=${second}`);
    } finally {
        const siteIds = seeded.map((s) => s.siteId).filter(Boolean);
        const userIds = seeded.map((s) => s.userId).filter(Boolean);
        if (siteIds.length > 0) {
            await db().delete(exchangeSites).where(inArray(exchangeSites.id, siteIds));
        }
        if (userIds.length > 0) {
            await db().delete(users).where(inArray(users.id, userIds));
        }
    }

    console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
    process.exit(failures === 0 ? 0 : 1);
}

void main();
