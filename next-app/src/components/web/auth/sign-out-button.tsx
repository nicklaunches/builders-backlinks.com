import { signOutAction } from "@/components/web/auth/auth-actions";
import { cn } from "@/components/web/cn";

/**
 * @file The sign-out affordance.
 *
 * A POST form for the same reasons as the sign-in buttons: signing out is a
 * state change, it inherits server-action CSRF protection, and a prefetching
 * browser or a link-scanning email client cannot sign someone out by touching
 * a URL. (A GET sign-out link is a classic way to log users out of your own
 * product from a third-party page.)
 *
 * Server component, no client JavaScript. Lives here rather than in the site
 * header so any surface that needs it can drop it in.
 */

export function SignOutButton({ className }: { className?: string }) {
    return (
        <form action={signOutAction}>
            <button
                type="submit"
                className={cn(
                    "border-line hover:border-line-strong hover:bg-surface-2 text-muted hover:text-fg w-full rounded-sm",
                    "border px-4 py-2.5 text-[14px] font-medium transition-colors",
                    className,
                )}>
                Sign out
            </button>
        </form>
    );
}
