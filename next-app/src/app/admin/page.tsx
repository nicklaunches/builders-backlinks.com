import type { Metadata } from "next";

import { ReviewPanel, type ReviewRow } from "@/app/admin/review-panel";
import { SiteFooter } from "@/components/web/site-footer";
import { SiteHeader } from "@/components/web/site-header";
import { requireAdmin } from "@/lib/auth/admin";
import { SITE_STATUSES, type SiteStatus } from "@/lib/exchange";
import { listSitesForReview } from "@/lib/services/sites";

/**
 * @file `/admin`, the review queue.
 *
 * This page is the reason the exchange can function at all. Every submission is
 * written `pending_review`, and matching, digests and the public catalog all
 * filter on `active`, so until something moved that column nothing could ever
 * be matched with anything. `paused`, `rejected` and `banned` were enum values
 * no code could reach.
 *
 * `requireAdmin()` answers 404, not 403, and does the same for signed-out
 * visitors rather than offering a sign-in prompt the way `/submit` and
 * `/app/key` do. Those are member surfaces that want to be found. This one does
 * not, and a 403 tells a stranger there is something here worth getting
 * credentials for. The real gate is repeated inside the server action, since
 * that is a POST endpoint reachable without ever loading this page.
 */

export const metadata: Metadata = {
    title: "Review queue",
    robots: { index: false, follow: false },
};

/** Session-dependent, and must never be cached. */
export const dynamic = "force-dynamic";

/** Fixed locale and time zone, matching `app/key/format.ts`, to avoid a hydration mismatch. */
const SUBMITTED_FORMAT = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
});

function parseStatus(raw: string | undefined): SiteStatus {
    return (SITE_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as SiteStatus) : "pending_review";
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
    await requireAdmin();

    const status = parseStatus((await searchParams).status);
    const sites = await listSitesForReview(status);

    // Dates are formatted here rather than in the client component, so the
    // server render and the browser cannot disagree about them.
    const rows: ReviewRow[] = sites.map((site) => ({
        id: site.id,
        domain: site.domain,
        url: site.url,
        ownerEmail: site.ownerEmail,
        category: site.category,
        description: site.description,
        keywords: site.keywords ?? [],
        domainRating: site.domainRating,
        placementOffered: site.placementOffered,
        status: site.status,
        submitted: SUBMITTED_FORMAT.format(site.createdAt),
        reviewNote: site.reviewNote,
    }));

    return (
        <>
            <SiteHeader signedIn />

            <main id="main">
                <div className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
                    <p className="text-muted mb-4 font-mono text-[11.5px] tracking-[0.14em] uppercase">Moderation</p>
                    <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[2.5rem]">
                        Review queue
                    </h1>
                    <p className="text-muted mt-4 text-[16px] leading-relaxed">
                        Nothing is matched until it is approved here. Read the description before deciding: it is what
                        partners see, a model wrote it from the site, and a wrong category means no useful matches
                        rather than bad ones.
                    </p>

                    <div className="mt-10">
                        <ReviewPanel rows={rows} status={status} />
                    </div>
                </div>
            </main>

            <SiteFooter />
        </>
    );
}
