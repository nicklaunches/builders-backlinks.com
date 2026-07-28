/**
 * @file Human copy for the `?error=` codes Auth.js puts on the sign-in page.
 *
 * Auth.js redirects failures to `pages.signIn` / `pages.error` with a code and
 * nothing else. Unhandled, the user sees a page that looks like nothing
 * happened, tries the same button again, and gets the same silence.
 *
 * The codes below are the client-safe set Auth.js is willing to disclose
 * (`clientErrors` in @auth/core), plus `Configuration`, which is what every
 * other failure is flattened into so server internals do not leak. Anything
 * unrecognised falls through to a generic message rather than being echoed:
 * the value is in the URL, so rendering it verbatim would be a reflected-text
 * injection point for a convincing fake error.
 *
 * OAuthAccountNotLinked is the one real users will actually hit, because
 * accounts are shared with nicklaunches.com: someone who signed up there with
 * Google and then presses GitHub here has an email that already belongs to a
 * user row with no GitHub account attached. Auth.js refuses to attach it (see
 * the `allowDangerousEmailAccountLinking` note in `src/auth.ts`), so the copy
 * has to explain both what happened and the one move that fixes it, which is
 * to use the provider they started with.
 */

export type SignInErrorMessage = {
    title: string;
    body: string;
};

const MESSAGES: Record<string, SignInErrorMessage> = {
    OAuthAccountNotLinked: {
        title: "You have already signed in with the other provider",
        body:
            "This email address already has an account, created with the other sign-in button. " +
            "Sign in with the provider you used the first time (Google if you started with Google, " +
            "GitHub if you started with GitHub) and you will land in the same account, with everything in it. " +
            "Your account is shared with Nick Launches, so this can be a sign-in you made over there.",
    },
    // Older alias for the same condition, kept so a version bump cannot quietly
    // turn a handled error back into a blank page.
    AccountNotLinked: {
        title: "You have already signed in with the other provider",
        body:
            "This email address already has an account, created with the other sign-in button. " +
            "Sign in with the provider you used the first time and you will land in the same account.",
    },
    AccessDenied: {
        title: "That sign-in was declined",
        body:
            "Google or GitHub did not grant the request. If you closed or cancelled their screen, " +
            "press the button again and approve it. If you have restrictions on your account, " +
            "the other provider may work.",
    },
    OAuthCallbackError: {
        title: "The provider did not finish the handshake",
        body:
            "Something failed between here and Google or GitHub on the way back. " +
            "This is usually momentary, so try again. If it keeps happening, try the other provider.",
    },
    OAuthSignin: {
        title: "We could not reach the provider",
        body: "The request to Google or GitHub did not get through. Check your connection and try again.",
    },
    Verification: {
        title: "That sign-in link is no longer valid",
        body: "Sign-in links expire, and they only work once. Start again from this page.",
    },
    MissingCSRF: {
        title: "That request expired",
        body:
            "The page sat open too long, or cookies are blocked for this site. " +
            "Reload this page and try again, and allow cookies for builders-backlinks.com if you have them off.",
    },
    CredentialsSignin: {
        title: "Those sign-in details were not accepted",
        body: "This site signs in with Google or GitHub only. Use one of the buttons below.",
    },
    Configuration: {
        title: "Sign-in is misconfigured on our side",
        body:
            "This one is on us, not on you, and nothing you press will fix it. " +
            "Please try again shortly, and tell us if it is still broken.",
    },
};

const FALLBACK: SignInErrorMessage = {
    title: "Sign-in did not complete",
    body: "Something went wrong on the way back from the provider. Try again, or use the other provider.",
};

/**
 * Maps a raw `?error=` value to copy that a person can act on.
 *
 * @param raw - The query param. Untrusted, and never rendered as-is.
 * @returns The message to show, or null when there is no error to report.
 */
export function signInErrorMessage(raw: unknown): SignInErrorMessage | null {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string" || !value) return null;
    return MESSAGES[value] ?? FALLBACK;
}
