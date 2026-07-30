import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { exchangeMembers } from "@/lib/db/schema";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";

/**
 * @file The opt-out page every email footer links to.
 *
 * ## No client JavaScript
 *
 * The controls are plain `<form action={serverAction}>` submits, not a client
 * toggle. This page is opened straight out of a mail client, frequently through
 * a privacy proxy or an in-app browser with scripts stripped, and an
 * unsubscribe surface that needs JS is an unsubscribe surface that sometimes
 * does not work. That is the one thing it is not allowed to be.
 *
 * ## The token is what makes the address trustworthy
 *
 * `?email=` on its own is a bare assertion. Acting on it would let anyone who
 * knew a member's address pause their account from a browser, and pausing here
 * is not just "stop the newsletter": `unsubscribedAt` also drops the member's
 * sites out of matching. So the write path requires `?t=`, an HMAC over the
 * address, and it re-verifies that token from the FORM BODY rather than
 * trusting the render that produced the form. A server action is a public POST
 * endpoint; the check has to live where the write lives.
 *
 * ## Why there is no "type your address" fallback
 *
 * The sibling app offers one, because unsubscribing there only stops a
 * newsletter. Here the same action pauses matching, so an untokenized form
 * would be a one-field denial-of-service against any member whose address you
 * could guess. Without a valid token this page explains itself and stops.
 *
 * ## It is reversible
 *
 * Nothing is deleted. `unsubscribedAt` is a timestamp, and the same page with
 * the same link clears it again, which is why the resubscribe button is offered
 * on the confirmation rather than buried in support.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Email preferences",
    description: "Stop or restart Builders Backlinks emails.",
    // Nothing to rank for, and every query-string variant is a duplicate.
    robots: { index: false, follow: false },
};

type SearchParams = {
    email?: string;
    /** Signed proof that the caller holds `email`. See `unsubscribe-token.ts`. */
    t?: string;
    status?: "unsubscribed" | "resubscribed" | "not-found" | "error";
};

function normalizeEmail(raw?: string): string {
    return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** Rebuilds this URL so a redirect after a write keeps the token in hand. */
function selfUrl(email: string, token: string, status: NonNullable<SearchParams["status"]>): string {
    return `/unsubscribe?email=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}&status=${status}`;
}

/**
 * Flips `unsubscribedAt` for a verified address.
 *
 * Shared by both buttons because they are the same write with a different
 * value, and one function means one place where the token is checked.
 */
async function setUnsubscribed(formData: FormData, value: Date | null): Promise<never> {
    const email = normalizeEmail(String(formData.get("email") ?? ""));
    const token = String(formData.get("t") ?? "");
    if (!email || !verifyUnsubscribeToken(email, token)) {
        redirect("/unsubscribe");
    }

    try {
        const updated = await db()
            .update(exchangeMembers)
            .set({ unsubscribedAt: value })
            .where(eq(exchangeMembers.email, email))
            .returning({ id: exchangeMembers.id });
        if (updated.length === 0) {
            redirect(selfUrl(email, token, "not-found"));
        }
    } catch (error) {
        // `redirect` throws to unwind, so a caught error here could be one of
        // ours. Rethrow anything Next owns rather than reporting it as a
        // database failure.
        if (error && typeof error === "object" && "digest" in error) throw error;
        console.error("unsubscribe write failed:", error);
        redirect(selfUrl(email, token, "error"));
    }

    redirect(selfUrl(email, token, value ? "unsubscribed" : "resubscribed"));
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const params = await searchParams;
    const email = normalizeEmail(params.email);
    const token = typeof params.t === "string" && params.t.length > 0 ? params.t : "";
    const verified = email.length > 0 && verifyUnsubscribeToken(email, token);

    async function unsubscribe(formData: FormData) {
        "use server";
        await setUnsubscribed(formData, new Date());
    }

    async function resubscribe(formData: FormData) {
        "use server";
        await setUnsubscribed(formData, null);
    }

    let currentlyOff = false;
    if (verified) {
        try {
            const member = await db().query.exchangeMembers.findFirst({
                where: eq(exchangeMembers.email, email),
                columns: { unsubscribedAt: true },
            });
            currentlyOff = member?.unsubscribedAt != null;
        } catch (error) {
            console.error("unsubscribe state read failed:", error);
        }
    }

    return (
        <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-16">
            <Link href="/" className="font-mono text-[15px] font-semibold tracking-tight">
                <span className="text-fg">builders</span>
                <span className="text-accent">/</span>
                <span className="text-fg">backlinks</span>
            </Link>

            <div className="border-line bg-surface mt-8 rounded-xl border p-6 sm:p-8">
                {!verified ? (
                    <>
                        <h1 className="text-xl font-semibold tracking-tight">This link is incomplete</h1>
                        <p className="text-muted mt-3 text-sm leading-6">
                            Email preferences can only be changed through the link in one of our emails, which carries a
                            signed proof that you hold the address. Some mail clients cut long links in half, so if you
                            copied this one by hand, try clicking it in the email instead.
                        </p>
                        <p className="text-muted mt-3 text-sm leading-6">
                            Signed in already? You can pause everything from your dashboard.
                        </p>
                        <Link
                            href="/app"
                            className="bg-accent text-accent-fg mt-6 inline-block rounded-lg px-4 py-2.5 text-sm font-semibold">
                            Open your dashboard
                        </Link>
                    </>
                ) : (
                    <>
                        <h1 className="text-xl font-semibold tracking-tight">
                            {params.status === "unsubscribed"
                                ? "Emails are off"
                                : params.status === "resubscribed"
                                  ? "Emails are back on"
                                  : currentlyOff
                                    ? "Your emails are already off"
                                    : "Email preferences"}
                        </h1>

                        <p className="text-muted mt-3 font-mono text-sm break-all">{email}</p>

                        {params.status === "not-found" ? (
                            <p className="text-muted mt-4 text-sm leading-6">
                                We have no member record for that address, so there was nothing to change.
                            </p>
                        ) : null}
                        {params.status === "error" ? (
                            <p className="text-muted mt-4 text-sm leading-6">
                                Something went wrong saving that. Try again in a moment.
                            </p>
                        ) : null}

                        {currentlyOff || params.status === "unsubscribed" ? (
                            <>
                                <p className="mt-4 text-sm leading-6">
                                    We have stopped emailing this address. Your account and your listings are still
                                    here, but your sites are paused in matching, so you will not be proposed to anyone
                                    new while this is off.
                                </p>
                                <form action={resubscribe} className="mt-6">
                                    <input type="hidden" name="email" value={email} />
                                    <input type="hidden" name="t" value={token} />
                                    <button
                                        type="submit"
                                        className="border-line-strong hover:bg-surface-2 rounded-lg border px-4 py-2.5 text-sm font-semibold">
                                        Turn emails back on
                                    </button>
                                </form>
                            </>
                        ) : (
                            <>
                                <p className="mt-4 text-sm leading-6">
                                    Unsubscribing stops every email we send, including the weekly digest and
                                    notifications about matches you are already in. It also pauses your sites in
                                    matching, since a match nobody is told about helps neither side.
                                </p>
                                <p className="text-muted mt-3 text-sm leading-6">
                                    Nothing is deleted, and you can turn it back on from this same page at any time.
                                </p>
                                <form action={unsubscribe} className="mt-6">
                                    <input type="hidden" name="email" value={email} />
                                    <input type="hidden" name="t" value={token} />
                                    <button
                                        type="submit"
                                        className="bg-accent text-accent-fg rounded-lg px-4 py-2.5 text-sm font-semibold">
                                        Unsubscribe
                                    </button>
                                </form>
                            </>
                        )}
                    </>
                )}
            </div>

            <p className="text-muted mt-6 text-xs">
                <Link href="/" className="underline">
                    builders-backlinks.com
                </Link>
            </p>
        </main>
    );
}
