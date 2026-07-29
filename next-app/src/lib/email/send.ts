import { render } from "@react-email/render";
import type { ReactElement } from "react";

import { eq } from "drizzle-orm";

import { buildUnsubscribeUrl, runWithEmailContext } from "@/emails/_context";
import { db } from "@/lib/db";
import { exchangeMembers } from "@/lib/db/schema";
import { type SesHeader, sendSesEmail } from "@/lib/email/ses";

/**
 * @file The one entry point for outgoing mail.
 *
 * Callers hand over a subject and a React element. Everything else (rendering
 * both bodies, the per-recipient unsubscribe URL, the opt-out gate, the SES
 * call) happens here, so there is exactly one place to audit when the question
 * is "could this have sent to someone who opted out".
 *
 * ## It no-ops without `EMAIL_FROM`
 *
 * This is the single most important behaviour in the file. Local development,
 * `pnpm test`, and every script run without SES credentials must be able to
 * call the real notification paths and have them do nothing loudly rather than
 * throw. A missing sender is a configuration state, not an error, so it logs a
 * warning and returns `false`.
 *
 * ## Failures never propagate
 *
 * Every error is caught and logged, and the boolean return is a hint rather
 * than a guarantee. Callers must not block a write on it: a member's match
 * still exists whether or not SES accepted the notification about it, and an
 * exchange that rolls back a database write because an email bounced is worse
 * than one that sends nothing.
 *
 * ## Where the opt-out gate runs
 *
 * Here, per recipient, before rendering. A digest cron will also pre-filter its
 * recipient list in one query rather than doing this per member, but that is an
 * optimisation, not the gate. This check is what makes a forgotten pre-filter a
 * wasted query instead of mail to someone who asked us to stop.
 *
 * It fails OPEN: an unreachable database drops the check rather than the mail.
 * That is the right direction for a check that mostly guards a weekly digest,
 * and the cron's own query-level filter is the first line of defence anyway.
 */

/**
 * Which bucket a message belongs to.
 *
 * `transactional` is mail about something the member is already doing: a match
 * they are in, a link they placed. It always sends. `digest` is the weekly
 * unprompted mail, which is gated on the member's opt-out and carries a
 * `List-Unsubscribe` header.
 */
export type SendCategory = "transactional" | "digest";

export type SendEmailInput = {
    to: string;
    subject: string;
    react: ReactElement;
    /** Optional override; defaults to `EMAIL_FROM`. */
    from?: string;
    /** Defaults to `transactional`, the bucket that is never dropped. */
    category?: SendCategory;
};

/**
 * Extracts the bare address from an RFC 5322 mailbox.
 *
 * `EMAIL_FROM` is usually stored in display-name form
 * (`Builders Backlinks <hi@…>`), which is valid in a `From` header but not
 * inside a `mailto:` URI.
 */
function bareAddress(mailbox: string): string {
    const match = mailbox.match(/<([^>]+)>/);
    return (match ? match[1] : mailbox).trim();
}

/**
 * Builds the RFC 2369 header for a digest.
 *
 * Both an `https:` and a `mailto:` target are listed because clients differ in
 * which one they honour. `List-Unsubscribe-Post` is deliberately NOT emitted:
 * RFC 8058 one-click requires an endpoint that accepts a bare cross-origin
 * POST, this app has no such route yet, and advertising one that 405s is worse
 * than not advertising it at all. Add the header in the same change that adds
 * the route, not before.
 */
function listUnsubscribeHeaders(unsubscribeUrl: string, sender: string): SesHeader[] {
    const mailto = `mailto:${bareAddress(sender)}?subject=unsubscribe`;
    return [{ name: "List-Unsubscribe", value: `<${unsubscribeUrl}>, <${mailto}>` }];
}

/**
 * True when this address has not switched their non-essential mail off.
 *
 * Fails open, on purpose: see the file header.
 */
async function allowsDigest(email: string): Promise<boolean> {
    try {
        const member = await db().query.exchangeMembers.findFirst({
            where: eq(exchangeMembers.email, email.trim().toLowerCase()),
            columns: { unsubscribedAt: true },
        });
        // No member row means this is not a digest recipient we know about.
        // Sending is still the caller's call; the gate only enforces a stored
        // opt-out, and inventing one from an absent record would silently
        // break a send to a member created in the same request.
        return member?.unsubscribedAt == null;
    } catch (error) {
        console.warn("digest opt-out check failed, allowing send:", error instanceof Error ? error.message : error);
        return true;
    }
}

/**
 * Renders a React Email element to HTML plus plain text and sends it via SES.
 *
 * @param input.to - Recipient address.
 * @param input.subject - Subject line.
 * @param input.react - The template element, already given its props.
 * @param input.from - Optional sender override, defaults to `EMAIL_FROM`.
 * @param input.category - See {@link SendCategory}. Defaults to transactional.
 * @returns `true` when SES accepted the message, `false` on missing config, an
 *          opt-out, or any error.
 */
export async function sendEmail({
    to,
    subject,
    react,
    from,
    category = "transactional",
}: SendEmailInput): Promise<boolean> {
    const sender = from ?? process.env.EMAIL_FROM;
    if (!sender) {
        console.warn("EMAIL_FROM is not set; skipping email:", subject, "->", to);
        return false;
    }

    if (category === "digest" && !(await allowsDigest(to))) {
        console.log("sendEmail: skipped, recipient has opted out:", subject, "->", to);
        return false;
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://builders-backlinks.com";
    const unsubscribeUrl = buildUnsubscribeUrl(origin, to);

    // The URL goes into the render context for EVERY category, including
    // transactional. Opting out here pauses the whole account (it also drops
    // the member's sites out of matching), so "stop sending me things" is a
    // request a member can legitimately make from a match notification, and a
    // footer link is cheaper for both sides than a support email. The header,
    // which mail clients turn into a one-tap control, is still digest-only.
    const headers = category === "digest" ? listUnsubscribeHeaders(unsubscribeUrl, sender) : undefined;

    try {
        const [html, text] = await runWithEmailContext({ unsubscribeUrl, siteOrigin: origin }, () =>
            Promise.all([render(react), render(react, { plainText: true })]),
        );
        await sendSesEmail({ to, from: sender, subject, text, html, headers });
        return true;
    } catch (error) {
        console.error("sendEmail failed:", subject, "->", to, error);
        return false;
    }
}
