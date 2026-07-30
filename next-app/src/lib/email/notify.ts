import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";

import { DigestEmail } from "@/emails/digest";
import { LinkRemovedEmail } from "@/emails/link-removed";
import { LinkVerifiedEmail } from "@/emails/link-verified";
import { MatchAgreedEmail } from "@/emails/match-agreed";
import { MatchProposedEmail } from "@/emails/match-proposed";
import { SiteApprovedEmail } from "@/emails/site-approved";
import { SiteRejectedEmail } from "@/emails/site-rejected";
import { SubmissionReceivedEmail } from "@/emails/submission-received";
import { WelcomeEmail } from "@/emails/welcome";
import type { Category } from "@/lib/categories";
import type { MaskedPartner } from "@/lib/contracts";
import { db } from "@/lib/db";
import { type ExchangeSite, exchangeMembers } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import type { Placement } from "@/lib/exchange";
import type { LinkBrief } from "@/lib/services/links";
import { toMaskedPartner, toRevealedPartner } from "@/lib/services/mask";

/**
 * @file The trigger layer: every email the product sends is fired from here.
 *
 * Subjects live in this file, not in the templates, matching the sibling app.
 * A template renders a body and knows nothing about when it is sent.
 *
 * TWO RULES, both load-bearing.
 *
 * 1. **Every export is fire and forget.** Each one catches its own errors and
 *    resolves to void, and callers invoke them with `void`. A flaky SES must
 *    never break a submission, a tool call, or a cron run. Email is the least
 *    important thing happening in any of those code paths.
 *
 *    Fire and forget is a Node idiom and on workerd it is a trap. A `void`ed
 *    promise is not a background task there, it is work the runtime is entitled
 *    to cancel the moment the response is returned, and cancellation is not an
 *    error: nothing throws, so `safely` below logs nothing. This shipped that
 *    way and sent NOTHING in production for its entire life. Twenty members had
 *    signed up and SES had recorded zero `welcome` sends; the only two sends in
 *    sixty days came from a laptop. `pnpm dev` cannot reproduce it, because on
 *    Node the process simply stays alive and the promise completes.
 *
 *    So `safely` now hands every send to `ctx.waitUntil` as well as awaiting it.
 *    Callers keep their `void` and keep not caring, and the invocation stays
 *    open until SES has actually answered.
 *
 * 2. **Masked views are built here, from `services/mask.ts`, never by hand.**
 *    `notifyMatchProposed` passes a `MaskedPartner`, which structurally has no
 *    domain to leak. `notifyMatchAgreed` passes a `RevealedPartner`, which
 *    `toRevealedPartner` refuses to build unless the match actually reached
 *    `agreed`. That means the identity boundary is enforced by the same code as
 *    the API, rather than by remembering to be careful in a template.
 */

/** Resolves the member email behind a site. Null when the member row is gone. */
async function emailForSite(site: ExchangeSite): Promise<string | null> {
    const [member] = await db()
        .select({ email: exchangeMembers.email })
        .from(exchangeMembers)
        .where(eq(exchangeMembers.userId, site.ownerId))
        .limit(1);
    return member?.email ?? null;
}

/**
 * Registers a send with the Worker so the runtime cannot cancel it.
 *
 * Mirrors `workerContext()` in `lib/db/index.ts`: `getCloudflareContext()`
 * throws rather than returning null outside a request, and scripts, the unit
 * tests and `pnpm emails:render` all take that path legitimately. There is no
 * lifetime to extend in a Node process, so swallowing is right here.
 */
function keepAlive(task: Promise<unknown>): void {
    try {
        getCloudflareContext().ctx.waitUntil(task);
    } catch {
        // Not in a Worker request. Awaiting the task is the whole lifetime.
    }
}

/**
 * Wraps a send so a failure is logged and swallowed. See rule 1.
 *
 * The task is started, registered, and only then awaited, and that order is the
 * point. `waitUntil` is what keeps a `void`ed caller's send alive past the
 * response; the `await` is what keeps an awaiting caller's pacing intact. The
 * digest cron relies on the second: it sends up to fifty in a loop, and SES
 * caps this account at fourteen a second, so turning that loop into fifty
 * concurrent sends would trade a silent failure for a throttled one.
 */
async function safely(label: string, run: () => Promise<unknown>): Promise<void> {
    const task = (async () => {
        try {
            await run();
        } catch (err) {
            console.error(`notify: ${label} failed`, err);
        }
    })();
    keepAlive(task);
    await task;
}

/**
 * Tells both sides a match exists. Partners are masked in both directions.
 *
 * Sent from `autoPair`, which is called synchronously on submit and from the
 * weekly cron. Before this existed a member could be matched and never told,
 * which made instant matching invisible.
 */
export async function notifyMatchProposed(input: {
    matchId: string;
    siteA: ExchangeSite;
    siteB: ExchangeSite;
    expiresAt: Date;
    widened?: boolean;
}): Promise<void> {
    const { matchId, siteA, siteB, expiresAt, widened } = input;

    await safely("match-proposed", async () => {
        const [emailA, emailB] = await Promise.all([emailForSite(siteA), emailForSite(siteB)]);

        // Each side is shown the OTHER, masked.
        const sends: Promise<unknown>[] = [];
        if (emailA) {
            sends.push(
                sendEmail({
                    to: emailA,
                    subject: "You have a new match in the exchange",
                    react: MatchProposedEmail({ matchId, partner: toMaskedPartner(siteB), expiresAt, widened }),
                    emailType: "match-proposed",
                }),
            );
        }
        if (emailB) {
            sends.push(
                sendEmail({
                    to: emailB,
                    subject: "You have a new match in the exchange",
                    react: MatchProposedEmail({ matchId, partner: toMaskedPartner(siteA), expiresAt, widened }),
                    emailType: "match-proposed",
                }),
            );
        }
        await Promise.all(sends);
    });
}

/**
 * Tells both sides they agreed, and reveals them to each other.
 *
 * The brief differs per recipient: each is told the URL THEY need to link to,
 * which is the other person's. Getting this backwards would have everyone
 * linking to themselves, so the two briefs are passed in explicitly rather than
 * derived here.
 */
export async function notifyMatchAgreed(input: {
    matchId: string;
    siteA: ExchangeSite;
    siteB: ExchangeSite;
    /** Brief for A, whose target is B. */
    briefForA: LinkBrief;
    /** Brief for B, whose target is A. */
    briefForB: LinkBrief;
}): Promise<void> {
    const { matchId, siteA, siteB, briefForA, briefForB } = input;

    await safely("match-agreed", async () => {
        const [emailA, emailB] = await Promise.all([emailForSite(siteA), emailForSite(siteB)]);
        const sends: Promise<unknown>[] = [];

        if (emailA && emailB) {
            sends.push(
                sendEmail({
                    to: emailA,
                    subject: "You both accepted, here is who you matched with",
                    react: MatchAgreedEmail({
                        matchId,
                        partner: toRevealedPartner(siteB, emailB, "agreed"),
                        brief: briefForA,
                    }),
                    emailType: "match-agreed",
                }),
                sendEmail({
                    to: emailB,
                    subject: "You both accepted, here is who you matched with",
                    react: MatchAgreedEmail({
                        matchId,
                        partner: toRevealedPartner(siteA, emailA, "agreed"),
                        brief: briefForB,
                    }),
                    emailType: "match-agreed",
                }),
            );
        }
        await Promise.all(sends);
    });
}

/** Reports a placement check to one member. */
export async function notifyLinkVerified(input: {
    site: ExchangeSite;
    direction: "given" | "received";
    pageUrl: string;
    targetDomain: string;
    found: boolean;
    inconclusive: boolean;
    placement: Placement;
    rel: readonly string[];
    anchorText: string | null;
    sitewide: boolean;
    message: string;
}): Promise<void> {
    await safely("link-verified", async () => {
        const to = await emailForSite(input.site);
        if (!to) return;

        const subject = input.found
            ? input.direction === "received"
                ? "Your partner's link to you is live"
                : "Your link is live and verified"
            : "We could not confirm that link yet";

        await sendEmail({
            to,
            subject,
            react: LinkVerifiedEmail({ ...input, checkedAt: new Date() }),
            emailType: "link-verified",
        });
    });
}

/**
 * Tells both parties a link stopped resolving.
 *
 * Deliberately sent to both. The member who lost the link usually did not mean
 * to (a redesign, a moved page), and the member who lost the benefit is the one
 * who most needs to know. Only telling one side turns an accident into a
 * grievance.
 */
export async function notifyLinkRemoved(input: {
    matchId: string;
    /** The site whose page was hosting the link. */
    hostSite: ExchangeSite;
    /** The site the link pointed at. */
    beneficiarySite: ExchangeSite;
    pageUrl: string;
    anchorText: string | null;
    firstSeenAt: Date | null;
    removedAt: Date;
}): Promise<void> {
    const { matchId, hostSite, beneficiarySite, pageUrl, anchorText, firstSeenAt, removedAt } = input;

    await safely("link-removed", async () => {
        const [hostEmail, beneficiaryEmail] = await Promise.all([
            emailForSite(hostSite),
            emailForSite(beneficiarySite),
        ]);
        const shared = {
            matchId,
            pageUrl,
            targetDomain: beneficiarySite.domain,
            hostDomain: hostSite.domain,
            anchorText,
            firstSeenAt,
            removedAt,
        };
        const sends: Promise<unknown>[] = [];

        if (hostEmail) {
            sends.push(
                sendEmail({
                    to: hostEmail,
                    subject: "A link on your site stopped resolving",
                    react: LinkRemovedEmail({ ...shared, role: "host" }),
                    emailType: "link-removed",
                }),
            );
        }
        if (beneficiaryEmail) {
            sends.push(
                sendEmail({
                    to: beneficiaryEmail,
                    subject: "A link pointing at you stopped resolving",
                    react: LinkRemovedEmail({ ...shared, role: "beneficiary" }),
                    emailType: "link-removed",
                }),
            );
        }
        await Promise.all(sends);
    });
}

/**
 * The weekly digest. Category `"digest"`, so it honours the opt-out.
 *
 * The caller must not invoke this with an empty candidate list. An empty digest
 * is worse than silence: it is the single most common way a matching product
 * loses someone in its first month.
 */
export async function notifyDigest(input: {
    to: string;
    category: Category;
    candidates: readonly MaskedPartner[];
    widenedCount?: number;
    standingNote?: string;
}): Promise<void> {
    if (input.candidates.length === 0) {
        console.warn("notify: refusing to send an empty digest to", input.to);
        return;
    }

    await safely("digest", () =>
        sendEmail({
            to: input.to,
            subject: `Builders in ${input.category} open to a trade`,
            react: DigestEmail({
                category: input.category,
                candidates: input.candidates,
                widenedCount: input.widenedCount,
                standingNote: input.standingNote,
            }),
            emailType: "digest",
            category: "digest",
        }),
    );
}

// ---------------------------------------------------------------------------
// Account and listing lifecycle
//
// The five above are all about a match or a link, which means they only ever
// arrive once somebody ELSE has acted. The four below are the member's own
// thread: signed up, submitted, approved, rejected. Without them a member can
// go from signing in to being matched having received nothing at all, and a
// submission sits in `pending_review` in total silence.
//
// All four are `transactional`. None is a digest, so none is opt-out-able: they
// are the record of what happened to that person's own account.
// ---------------------------------------------------------------------------

/**
 * First email a member ever gets, fired the once from `getSessionMember`.
 *
 * That call site is the reason there is no "welcomed_at" column. It inserts
 * with `onConflictDoNothing().returning()`, so exactly one request in any race
 * gets a row back, and that request is the one that sends this.
 */
export async function notifyWelcome(input: { to: string }): Promise<void> {
    await safely("welcome", () =>
        sendEmail({
            to: input.to,
            subject: "Welcome to the exchange",
            react: WelcomeEmail(),
            emailType: "welcome",
        }),
    );
}

/**
 * Acknowledges a submission and echoes the listing back for correction.
 *
 * Sent from `commitSite`. Fire and forget like everything else here: a member
 * whose site was written but whose confirmation email failed still has a site.
 */
export async function notifySubmissionReceived(input: { site: ExchangeSite }): Promise<void> {
    const { site } = input;

    await safely("submission-received", async () => {
        const to = await emailForSite(site);
        if (!to) return;

        await sendEmail({
            to,
            subject: `We have ${site.domain}, it is in review`,
            react: SubmissionReceivedEmail({
                domain: site.domain,
                category: site.category,
                description: site.description,
                keywords: site.keywords ?? [],
                domainRating: site.domainRating,
                placementOffered: site.placementOffered,
            }),
            emailType: "submission-received",
        });
    });
}

/**
 * A listing passed review and is now matchable.
 *
 * Says nothing about whether a partner was found. Approving runs `autoPair`,
 * which sends its own `match-proposed` when it succeeds, and promising a match
 * that never arrives is worse than promising nothing.
 */
export async function notifySiteApproved(input: { site: ExchangeSite }): Promise<void> {
    const { site } = input;

    await safely("site-approved", async () => {
        const to = await emailForSite(site);
        if (!to) return;

        await sendEmail({
            to,
            subject: `${site.domain} is live in the exchange`,
            react: SiteApprovedEmail({ domain: site.domain, category: site.category }),
            emailType: "site-approved",
        });
    });
}

/**
 * A listing was refused, carrying the reviewer's note as the reason.
 *
 * `/terms` section 4 promises the member is told why, so the note is the point
 * of this email rather than a footnote. A rejection recorded with no note still
 * sends: silence would break the same promise, and the template says plainly
 * that no reason was recorded rather than inventing one.
 */
export async function notifySiteRejected(input: { site: ExchangeSite; reason: string | null }): Promise<void> {
    const { site, reason } = input;

    await safely("site-rejected", async () => {
        const to = await emailForSite(site);
        if (!to) return;

        await sendEmail({
            to,
            subject: `About your submission of ${site.domain}`,
            react: SiteRejectedEmail({ domain: site.domain, reason }),
            emailType: "site-rejected",
        });
    });
}
