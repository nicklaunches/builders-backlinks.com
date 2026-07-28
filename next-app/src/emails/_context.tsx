import { AsyncLocalStorage } from "node:async_hooks";

import { signUnsubscribeTokenSafe } from "@/lib/email/unsubscribe-token";

/**
 * @file Render-time context for shared email chrome.
 *
 * `sendEmail` populates this `AsyncLocalStorage` before rendering a template so
 * `EmailLayout` can read recipient-specific values (the unsubscribe URL, the
 * public origin) without every template threading two more props through every
 * caller.
 *
 * Why `AsyncLocalStorage` and not `React.createContext`? React context is not
 * available in Server Components (Next rejects `createContext` at import time),
 * and these templates render on the server through `@react-email/render`. ALS is
 * the Node-side equivalent and it survives the awaits inside the render path.
 *
 * Reading it is always safe: with no store set (the `emails:render` script, a
 * unit test) `getEmailContext` returns an empty object and the layout falls
 * back to the public origin with no unsubscribe link. That fallback is why the
 * render script can exercise every template without booting a send path.
 */

export type EmailRenderContextValue = {
    /** Per-recipient unsubscribe URL, injected by `sendEmail`. */
    unsubscribeUrl?: string;
    /** Public site origin, no trailing slash. Used for every link in the chrome. */
    siteOrigin?: string;
};

/** Where links point when nothing set a context (scripts, tests, previews). */
export const DEFAULT_SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? "https://builders-backlinks.com";

const store = new AsyncLocalStorage<EmailRenderContextValue>();

export function runWithEmailContext<T>(value: EmailRenderContextValue, fn: () => T): T {
    return store.run(value, fn);
}

export function getEmailContext(): EmailRenderContextValue {
    return store.getStore() ?? {};
}

/**
 * The origin every in-template link should be built from.
 *
 * Templates must call this rather than reading the env var directly, so a send
 * that set an explicit origin (a preview deploy, a staging host) stays
 * internally consistent instead of half of the links pointing at production.
 */
export function getSiteOrigin(): string {
    return getEmailContext().siteOrigin ?? DEFAULT_SITE_ORIGIN;
}

/**
 * Builds the public unsubscribe URL for a recipient.
 *
 * The signed `t` is what lets the page trust `email` instead of taking any
 * address in a query string at face value. Signed with the non-throwing helper:
 * a render must never fail because a secret is missing, so an unconfigured
 * environment produces a link to the untokenized form rather than a broken
 * send.
 */
export function buildUnsubscribeUrl(origin: string, recipientEmail: string): string {
    const base = `${origin}/unsubscribe?email=${encodeURIComponent(recipientEmail)}`;
    const token = signUnsubscribeTokenSafe(recipientEmail);
    return token ? `${base}&t=${encodeURIComponent(token)}` : base;
}
