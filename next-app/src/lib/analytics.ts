import { sendGAEvent } from "@next/third-parties/google";

/**
 * @file Product analytics: GA4, and the handful of events worth counting.
 *
 * OFF UNLESS `NEXT_PUBLIC_GA_ID` IS SET AT BUILD TIME. The id is inlined into
 * the client bundle by `next build`, so a local build, the CI build and the
 * end-to-end suite all carry no id, the tag never loads, and {@link track} is a
 * no-op. That is what keeps development traffic out of the real property, and
 * it is why the id lives in `.env.local` on the machine that deploys.
 *
 * Page views come from the tag itself; Cloudflare Web Analytics, injected at
 * the edge, counts them too. Events are the reason GA4 is here at all: the
 * four below are the funnel, and nothing else is tracked. Adding an event means
 * adding it to {@link AnalyticsEvent} first, so the whole vocabulary is in one
 * place and a typo cannot create a fifth.
 */

/** The GA4 measurement id, or null when analytics is off. */
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || null;

/** Every event this app sends. The funnel, and only the funnel. */
export type AnalyticsEvent = "submit_site" | "issue_key" | "accept_match" | "decline_match" | "send_message";

/**
 * Records one event. Client only, and silent when analytics is off.
 *
 * Parameters are kept to plain scalars on purpose: never a domain, an email or
 * a message body. GA4 is a third party, and the masking boundary this product
 * is built around does not stop at our own database.
 */
export function track(event: AnalyticsEvent, params?: Record<string, string | number | boolean>): void {
    if (!GA_ID || typeof window === "undefined") return;
    sendGAEvent("event", event, params ?? {});
}
