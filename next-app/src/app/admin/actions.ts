"use server";

import { requireAdmin } from "@/lib/auth/admin";
import { SITE_STATUSES, type SiteStatus } from "@/lib/exchange";
import { SiteError, setSiteStatus } from "@/lib/services/sites";

/**
 * @file The one mutation the review surface has.
 *
 * `requireAdmin()` is called INSIDE the action, not just on the page that
 * renders the button. A server action is a POST endpoint that anyone who knows
 * its id can call, so gating the page it happens to be imported by protects
 * nothing at all. This is the actual boundary.
 *
 * No `revalidatePath`. Nothing in this app uses it (see the note in
 * `app/key/actions.ts`), and the panel already holds the queue in state, so it
 * drops the row it just acted on rather than refetching the page around it.
 */

export type ReviewState =
    | { status: "idle" }
    | { status: "error"; siteId: string; message: string }
    | { status: "done"; siteId: string; applied: SiteStatus; domain: string };

/**
 * Moves one site to a new status.
 *
 * Both failure modes return rather than throw, because a thrown error in a
 * server action reaches the client as a generic digest with no useful message,
 * and "why did that not work" is exactly what a reviewer needs to know.
 */
export async function setSiteStatusAction(_previous: ReviewState, formData: FormData): Promise<ReviewState> {
    await requireAdmin();

    const siteId = String(formData.get("siteId") ?? "");
    const next = String(formData.get("status") ?? "");
    const reviewNote = String(formData.get("reviewNote") ?? "").trim();

    if (!siteId) {
        return { status: "error", siteId, message: "No site id was submitted." };
    }
    if (!(SITE_STATUSES as readonly string[]).includes(next)) {
        return { status: "error", siteId, message: `"${next}" is not a site status.` };
    }
    const status = next as SiteStatus;

    // /terms promises a refused site is told why, and this is the only place
    // that reason can be captured. Enforced here rather than left to the form,
    // because the action is reachable without it.
    if (status === "rejected" && !reviewNote) {
        return {
            status: "error",
            siteId,
            message: "A rejection needs a reason. It is sent to the member, and /terms promises they get one.",
        };
    }

    try {
        const site = await setSiteStatus(siteId, status, reviewNote || undefined);
        return { status: "done", siteId, applied: status, domain: site.domain };
    } catch (err) {
        if (err instanceof SiteError) {
            return { status: "error", siteId, message: err.message };
        }
        console.error("admin: setSiteStatus failed", err);
        return { status: "error", siteId, message: "Could not update that site. The error was logged." };
    }
}
