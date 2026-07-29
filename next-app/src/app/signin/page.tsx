import type { Metadata } from "next";
import Link from "next/link";

import { safeCallbackUrl } from "@/components/web/auth/callback-url";
import { ProviderButton } from "@/components/web/auth/provider-button";
import { signInErrorMessage } from "@/components/web/auth/sign-in-errors";
import { SignOutButton } from "@/components/web/auth/sign-out-button";
import { Wordmark } from "@/components/web/wordmark";
import { getSessionUser } from "@/lib/session";

/**
 * @file The sign-in page.
 *
 * Server component, zero client JavaScript: both buttons are form submits into
 * server actions, so this page works before hydration and with scripting off.
 *
 * Beyond collecting a sign-in it EXPLAINS FAILURES. Auth.js hands failures back
 * as a bare `?error=` code and, unhandled, the user just gets this page again
 * with no explanation. See `sign-in-errors.ts`.
 *
 * Deliberately NOT here: email and password, and magic links. The SES stack is
 * not wired up in this app yet, so both would be sign-in paths that quietly
 * fail to deliver. Both arrive once the email stack works.
 *
 * The page reads the session through `@/lib/session`, not `@/auth` directly,
 * per the rule at the top of that file. Only `auth-actions.ts` touches `@/auth`.
 */

export const metadata: Metadata = {
    title: "Sign in",
    description: "Sign in to Builders Backlinks with Google or GitHub.",
    // A sign-in page has nothing to rank for and every query string variant of
    // it is a duplicate, so keep it out of the index entirely.
    robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SignInPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const params = await searchParams;

    // Validated before it is ever put in a form or a link. An unchecked
    // callbackUrl on a real sign-in page is an open redirect, and a phisher
    // would rather have one of those than a whole fake site.
    const callbackUrl = safeCallbackUrl(params.callbackUrl);
    const error = signInErrorMessage(params.error);
    const user = await getSessionUser();

    return (
        <main id="main" className="relative flex min-h-dvh flex-col overflow-hidden">
            <div
                aria-hidden="true"
                className="hairline-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(70%_55%_at_50%_0%,black,transparent)] opacity-[0.35]"
            />

            <div className="relative flex flex-1 flex-col items-center justify-center px-5 py-12 sm:px-6">
                <Link href="/" className="rounded-sm" aria-label="Builders Backlinks, home">
                    <Wordmark className="text-[16px]" />
                </Link>

                <div className="border-line bg-surface mt-8 w-full max-w-[26rem] rounded-sm border p-6 sm:p-8">
                    {user ? (
                        <>
                            <h1 className="text-[1.4rem] font-semibold tracking-[-0.02em]">
                                You are already signed in
                            </h1>
                            <p className="text-muted mt-2.5 text-[14.5px] leading-relaxed">
                                As{" "}
                                <span className="text-fg font-mono">{user.email ?? user.name ?? "your account"}</span>.
                                Carry on, or sign out and use a different account.
                            </p>

                            <div className="mt-6 flex flex-col gap-3">
                                {/* A plain anchor, not `Link`: this is the one
                                    navigation where a full document load is
                                    wanted, so the destination re-renders on the
                                    server with the session cookie rather than
                                    from a router cache entry taken while the
                                    person was signed out. */}
                                <a
                                    href={callbackUrl}
                                    className="bg-accent text-accent-fg hover:bg-accent-hover flex w-full items-center justify-center rounded-sm px-4 py-3 text-[15px] font-semibold transition-colors">
                                    Continue
                                </a>
                                <SignOutButton />
                            </div>
                        </>
                    ) : (
                        <>
                            <h1 className="text-[1.4rem] font-semibold tracking-[-0.02em]">Sign in</h1>
                            <p className="text-muted mt-2.5 text-[14.5px] leading-relaxed">
                                New here? The same two buttons create your account. There is no separate sign-up.
                            </p>

                            {error ? (
                                <div
                                    role="alert"
                                    className="border-line bg-surface-2 mt-6 rounded-sm border px-4 py-3.5">
                                    <p className="text-[14px] font-semibold">{error.title}</p>
                                    <p className="text-muted mt-1.5 text-[13.5px] leading-relaxed">{error.body}</p>
                                </div>
                            ) : null}

                            <div className="mt-6 flex flex-col gap-3">
                                <ProviderButton provider="google" label="Google" callbackUrl={callbackUrl} />
                                <ProviderButton provider="github" label="GitHub" callbackUrl={callbackUrl} />
                            </div>
                        </>
                    )}
                </div>

                <p className="text-muted mt-6 max-w-[26rem] text-center text-[12.5px] leading-relaxed">
                    By continuing you agree to the{" "}
                    <a href="/terms" className="hover:text-fg underline underline-offset-2 transition-colors">
                        Terms
                    </a>{" "}
                    and the{" "}
                    <a href="/privacy" className="hover:text-fg underline underline-offset-2 transition-colors">
                        Privacy policy
                    </a>
                    .
                </p>
            </div>
        </main>
    );
}
